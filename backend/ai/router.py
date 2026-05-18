"""FastAPI routes for the conversational AI runtime — mounted at /api/ai."""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.responses import Response, StreamingResponse

from backend.ai.agent import AIDisabledError, resume_agent, run_agent, stream_agent
from backend.ai.checkpointer import get_saver
from backend.ai.config import get_settings
from backend.ai.schemas import (
    ChatRequest,
    ChatResponse,
    RealtimeVoiceTokenResponse,
    ResumeRequest,
    TTSRequest,
    TranscriptionResponse,
    VoiceStatusResponse,
)
from backend.ai.voice import (
    create_realtime_scribe_token,
    open_speech_stream,
    open_tts_websocket,
    synthesize_speech,
    transcribe_audio,
)
from backend.api.deps import get_current_user, get_db
from backend.db.connection import get_connection
from backend.services.auth import AuthError, AuthUser, resolve_authenticated_user

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


@router.post("/voice/speak")
async def ai_speak(body: TTSRequest, user: AuthUser = Depends(get_current_user)):
    _ = user
    audio, provider, err = await synthesize_speech(body.text, body.voice)
    if not audio:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=err or "TTS unavailable")
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store", "X-TTS-Provider": provider or ""},
    )


@router.post("/voice/speak/stream")
async def ai_speak_stream(body: TTSRequest, user: AuthUser = Depends(get_current_user)):
    _ = user
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text required")
    if not get_settings().elevenlabs_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ELEVENLABS_API_KEY is not set on the server.",
        )
    client, upstream, err = await open_speech_stream(text, body.voice)
    if not client or not upstream:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=err or "TTS unavailable")

    async def _audio_chunks():
        try:
            async for chunk in upstream.aiter_bytes():
                if chunk:
                    yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        _audio_chunks(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store", "X-TTS-Provider": "elevenlabs"},
    )


@router.post("/voice/realtime-token", response_model=RealtimeVoiceTokenResponse)
async def ai_realtime_voice_token(user: AuthUser = Depends(get_current_user)) -> RealtimeVoiceTokenResponse:
    _ = user
    token, err = await create_realtime_scribe_token()
    if not token:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=err or "Realtime STT unavailable")
    s = get_settings()
    lang = (s.elevenlabs_stt_language or "en").strip().lower()
    if lang in {"", "auto", "detect"}:
        lang = "en"
    return RealtimeVoiceTokenResponse(
        token=token,
        model_id=s.elevenlabs_realtime_stt_model,
        language_code=lang,
    )


@router.post("/voice/transcribe", response_model=TranscriptionResponse)
async def ai_transcribe(
    user: AuthUser = Depends(get_current_user),
    file: UploadFile = File(...),
):
    _ = user
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Audio too large")
    text, err = await transcribe_audio(
        filename=file.filename or "speech.webm",
        content_type=file.content_type or "application/octet-stream",
        content=content,
    )
    if text is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=err or "Transcription failed")
    return TranscriptionResponse(text=text)


def _ws_authenticate(token: str) -> Optional[AuthUser]:
    """Verify a JWT supplied via query string (browsers cannot set WS headers)."""
    if not token:
        return None
    db = get_connection()
    try:
        return resolve_authenticated_user(db, token)
    except AuthError:
        return None
    finally:
        with contextlib.suppress(Exception):
            db.close()


@router.websocket("/voice/tts/ws")
async def ai_tts_websocket(
    websocket: WebSocket,
    token: str = Query(""),
    voice: str = Query(""),
):
    """Bidirectional TTS bridge to ElevenLabs ``stream-input``.

    Client → server messages (JSON text frames):
      - ``{"type":"text","text":"..."}``  append a token chunk
      - ``{"type":"flush"}``               signal end of utterance
      - ``{"type":"abort"}``               immediately stop generation

    Server → client messages:
      - binary frames: PCM 16-bit little-endian, 16 kHz mono (concatenable)
      - ``{"type":"first_audio"}`` once on the first audio frame
      - ``{"type":"end"}`` when the utterance is fully generated
      - ``{"type":"error","detail":"..."}`` on failure
    """
    import websockets as _websockets

    user = _ws_authenticate(token)
    if user is None:
        await websocket.close(code=4401)
        return

    if not get_settings().elevenlabs_api_key:
        await websocket.accept()
        await websocket.send_json({"type": "error", "detail": "ELEVENLABS_API_KEY is not set on the server."})
        await websocket.close(code=1011)
        return

    await websocket.accept()

    try:
        async with open_tts_websocket(voice or None) as upstream:
            first_audio_sent = False
            done_event = asyncio.Event()

            async def pump_client_to_eleven() -> None:
                """Forward client text frames to ElevenLabs."""
                try:
                    while True:
                        raw = await websocket.receive_text()
                        try:
                            msg = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        kind = str(msg.get("type") or "")
                        if kind == "text":
                            chunk = str(msg.get("text") or "")
                            if not chunk:
                                continue
                            await upstream.send(json.dumps({"text": chunk, "try_trigger_generation": True}))
                        elif kind == "flush":
                            await upstream.send(json.dumps({"text": "", "flush": True}))
                        elif kind == "abort":
                            done_event.set()
                            return
                except WebSocketDisconnect:
                    done_event.set()
                except Exception as exc:  # noqa: BLE001
                    LOGGER.warning("TTS WS client pump failed: %s", exc)
                    done_event.set()

            async def pump_eleven_to_client() -> None:
                """Forward ElevenLabs audio chunks back to the browser."""
                nonlocal first_audio_sent
                try:
                    async for frame in upstream:
                        if isinstance(frame, (bytes, bytearray)):
                            await websocket.send_bytes(bytes(frame))
                            continue
                        try:
                            payload = json.loads(frame)
                        except json.JSONDecodeError:
                            continue
                        b64 = payload.get("audio")
                        if isinstance(b64, str) and b64:
                            audio_bytes = base64.b64decode(b64)
                            if audio_bytes:
                                if not first_audio_sent:
                                    first_audio_sent = True
                                    await websocket.send_json({"type": "first_audio"})
                                await websocket.send_bytes(audio_bytes)
                        if payload.get("isFinal"):
                            await websocket.send_json({"type": "end"})
                            done_event.set()
                            return
                except _websockets.ConnectionClosed:
                    if not done_event.is_set():
                        await websocket.send_json({"type": "end"})
                    done_event.set()
                except Exception as exc:  # noqa: BLE001
                    LOGGER.warning("TTS WS upstream pump failed: %s", exc)
                    with contextlib.suppress(Exception):
                        await websocket.send_json({"type": "error", "detail": str(exc)[:200]})
                    done_event.set()

            client_task = asyncio.create_task(pump_client_to_eleven())
            upstream_task = asyncio.create_task(pump_eleven_to_client())
            await done_event.wait()

            for task in (client_task, upstream_task):
                if not task.done():
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await task
    except WebSocketDisconnect:
        return
    except Exception as exc:  # noqa: BLE001
        LOGGER.exception("TTS WS bridge failed: %s", exc)
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "error", "detail": str(exc)[:200]})
    finally:
        with contextlib.suppress(Exception):
            await websocket.close()
