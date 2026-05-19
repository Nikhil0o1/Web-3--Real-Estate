"""FastAPI routes for the conversational AI runtime — mounted at /api/ai."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response, StreamingResponse

from backend.ai.agent import AIDisabledError, resume_agent, run_agent, stream_agent
from backend.ai.checkpointer import get_saver
from backend.ai.config import get_settings
from backend.ai.schemas import (
    ChatRequest,
    ChatResponse,
    ResumeRequest,
    TTSRequest,
    TranscriptionResponse,
    VoiceStatusResponse,
)
from backend.ai.voice import synthesize_speech, transcribe_audio
from backend.api.deps import get_current_user, get_db
from backend.services.auth import AuthUser

LOGGER = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _thread_id(user: AuthUser, client_session_id: str | None, body_thread_id: str | None) -> str:
    """Stable thread id per user + optional client session or explicit thread id."""
    if body_thread_id:
        return body_thread_id
    base = f"user:{user.wallet_address or user.id}"
    if client_session_id:
        return f"{base}:session:{client_session_id}"
    return base


@router.get("/status", response_model=VoiceStatusResponse)
def ai_status(user: AuthUser = Depends(get_current_user)) -> VoiceStatusResponse:
    _ = user
    s = get_settings()
    has_eleven = bool(s.elevenlabs_api_key)
    return VoiceStatusResponse(
        stt_enabled=has_eleven,
        tts_enabled=has_eleven,
        tts_provider="elevenlabs" if has_eleven else "off",
    )


@router.post("/chat", response_model=ChatResponse)
async def ai_chat(
    body: ChatRequest,
    user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
) -> ChatResponse:
    if not body.messages:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="messages required")
    try:
        checkpointer = await get_saver()
        thread_id = _thread_id(user, body.client_session_id, body.thread_id)
        return await run_agent(user, body.messages, db, thread_id=thread_id, checkpointer=checkpointer)
    except AIDisabledError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        LOGGER.exception("AI chat failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)[:300])


@router.post("/resume", response_model=ChatResponse)
async def ai_resume(
    body: ResumeRequest,
    user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
) -> ChatResponse:
    """Resume an interrupted conversation after user confirmation or denial."""
    try:
        checkpointer = await get_saver()
        return await resume_agent(
            user, db, thread_id=body.thread_id, approve=body.approve, checkpointer=checkpointer
        )
    except AIDisabledError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        LOGGER.exception("AI resume failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)[:300])


@router.post("/chat/stream")
async def ai_chat_stream(
    body: ChatRequest,
    user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
):
    """Stream the agent response as Server-Sent Events (SSE).

    Each event is a JSON payload with a ``type`` field:
    - ``token`` — a streamed LLM token
    - ``tool_start`` / ``tool_end`` — tool execution lifecycle
    - ``complete`` — final reply + actions (+ optional interrupt)
    """
    if not body.messages:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="messages required")

    async def _event_generator():
        try:
            checkpointer = await get_saver()
            thread_id = _thread_id(user, body.client_session_id, body.thread_id)
            async for event in stream_agent(
                user, body.messages, db, thread_id=thread_id, checkpointer=checkpointer
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except AIDisabledError as exc:
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)})}\n\n"
        except Exception as exc:  # noqa: BLE001
            LOGGER.exception("AI stream failed: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)[:300]})}\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/voice/transcribe", response_model=TranscriptionResponse)
async def ai_transcribe(
    user: AuthUser = Depends(get_current_user),
    file: UploadFile = File(...),
) -> TranscriptionResponse:
    """ElevenLabs Scribe — speech to text."""
    _ = user
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty audio")
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="audio too large (25 MB max)",
        )
    text, err = await transcribe_audio(
        filename=file.filename or "speech.webm",
        content_type=file.content_type or "application/octet-stream",
        content=content,
    )
    if text is None:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=err or "transcription failed",
        )
    return TranscriptionResponse(text=text)


@router.post("/voice/speak")
async def ai_speak(
    body: TTSRequest,
    user: AuthUser = Depends(get_current_user),
) -> Response:
    """ElevenLabs TTS — returns MP3 audio for the given text."""
    _ = user
    audio, err = await synthesize_speech(body.text, body.voice)
    if not audio:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=err or "TTS unavailable",
        )
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )
