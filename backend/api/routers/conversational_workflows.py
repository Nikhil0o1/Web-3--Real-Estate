"""Conversational workflow automation API.

This router exposes deterministic workflow turns for voice and text clients. It
returns typed frontend actions only; existing product endpoints and MetaMask
flows remain the execution boundary.
"""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.agents.config.settings import get_ai_settings
from backend.agents.context.session import context_from_auth_user
from backend.agents.observability.logging import new_trace_id
from backend.agents.orchestrator.service import get_orchestration_service
from backend.agents.schemas.workflow import (
    WorkflowTemplateRead,
    WorkflowTranscriptionResponse,
    WorkflowTranscriptionStatus,
    WorkflowTurnRequest,
    WorkflowTurnResponse,
    derive_workflow_phase,
)
from backend.agents.workflows.templates import list_workflow_templates
from backend.api.deps import get_current_user, get_db
from backend.services.auth import AuthUser, canonical_role


class WorkflowSpeechRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    voice: str | None = Field(default=None, max_length=40)

router = APIRouter(prefix="/workflows", tags=["conversational-workflows"])


@router.get("/templates", response_model=list[WorkflowTemplateRead])
def workflow_templates(user: AuthUser = Depends(get_current_user)):
    role = canonical_role(user.role)
    return [
        WorkflowTemplateRead(
            workflow_id=t.workflow_id,
            label=t.label,
            endpoint=t.endpoint,
            method=t.method,
            roles=list(t.roles),
            required_fields=list(t.required_keys),
            metamask_required=t.metamask_required,
            success_behavior=t.success_behavior,
        )
        for t in list_workflow_templates()
        if role in t.roles
    ]


@router.get("/transcription-status", response_model=WorkflowTranscriptionStatus)
def transcription_status(user: AuthUser = Depends(get_current_user)):
    _ = user
    key = (get_ai_settings().openai_api_key or "").strip()
    return WorkflowTranscriptionStatus(enabled=bool(key))


async def _elevenlabs_tts(text: str, voice_override: str | None) -> bytes | None:
    """Try ElevenLabs TTS — returns MP3 bytes or None when key is missing / call fails."""
    settings = get_ai_settings()
    key = (settings.elevenlabs_api_key or "").strip()
    if not key:
        return None
    voice_id = (voice_override or settings.elevenlabs_voice_id or "21m00Tcm4TlvDq8ikWAM").strip()
    model_id = (settings.elevenlabs_model or "eleven_turbo_v2_5").strip()
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
    payload = {
        "text": text[:3800],
        "model_id": model_id,
        "voice_settings": {"stability": 0.4, "similarity_boost": 0.75, "style": 0.2, "use_speaker_boost": True},
    }
    headers = {
        "xi-api-key": key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(url, headers=headers, json=payload)
        except httpx.HTTPError:
            return None
    if response.status_code >= 400:
        return None
    return response.content


async def _openai_tts(text: str, voice_override: str | None) -> tuple[bytes | None, str | None]:
    """OpenAI TTS — returns (mp3 bytes, error_detail)."""
    settings = get_ai_settings()
    if not (settings.openai_api_key or "").strip():
        return None, "OPENAI_API_KEY missing"
    model = os.getenv("AI_TTS_MODEL", "gpt-4o-mini-tts").strip() or "gpt-4o-mini-tts"
    default_voice = os.getenv("AI_TTS_VOICE", "alloy").strip() or "alloy"
    voice = (voice_override or default_voice).strip().lower()
    url = f"{settings.openai_base_url}/audio/speech"
    payload = {
        "model": model,
        "voice": voice,
        "input": text[:3800],
        "response_format": "mp3",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        except httpx.HTTPError as exc:
            return None, str(exc)[:200]
    if response.status_code >= 400:
        return None, (response.text or response.reason_phrase)[:300]
    return response.content, None


@router.post("/speak")
async def synthesize_speech(
    body: WorkflowSpeechRequest,
    user: AuthUser = Depends(get_current_user),
):
    """Return MP3 audio synthesized from `text`.

    Tries ElevenLabs first (when ELEVENLABS_API_KEY is set), then OpenAI TTS.
    Returns 503 only when both providers are unavailable so the frontend can
    degrade gracefully to browser speechSynthesis.
    """
    _ = user
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text required")

    audio = await _elevenlabs_tts(text, body.voice)
    if audio:
        return Response(
            content=audio,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store", "X-TTS-Provider": "elevenlabs"},
        )

    audio, err = await _openai_tts(text, body.voice)
    if audio:
        return Response(
            content=audio,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store", "X-TTS-Provider": "openai"},
        )

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=err or "No TTS provider configured (set ELEVENLABS_API_KEY or OPENAI_API_KEY).",
    )


@router.post("/transcribe", response_model=WorkflowTranscriptionResponse)
async def transcribe_audio(
    user: AuthUser = Depends(get_current_user),
    file: UploadFile = File(...),
):
    _ = user
    settings = get_ai_settings()
    if not (settings.openai_api_key or "").strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OPENAI_API_KEY is not set — transcription unavailable.",
        )
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Audio too large")
    model = os.getenv("AI_WHISPER_MODEL", "whisper-1").strip() or "whisper-1"
    # ISO-639-1 — omit or change via AI_WHISPER_LANGUAGE (e.g. ``ko``) for non-English users.
    whisper_language = os.getenv("AI_WHISPER_LANGUAGE", "en").strip().lower()
    whisper_prompt = os.getenv(
        "AI_WHISPER_PROMPT",
        "English. Real estate app: property, invest, tokens, rent, Ethereum, MetaMask.",
    ).strip()
    filename = file.filename or "audio.webm"
    ctype = file.content_type or "application/octet-stream"
    url = f"{settings.openai_base_url}/audio/transcriptions"
    form_data: dict[str, str] = {"model": model}
    if whisper_language and whisper_language not in {"auto", "detect"}:
        form_data["language"] = whisper_language[:16]
    if whisper_prompt:
        form_data["prompt"] = whisper_prompt[:1200]
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            url,
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            files={"file": (filename, content, ctype)},
            data=form_data,
        )
    if response.status_code >= 400:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(response.text or response.reason_phrase)[:800],
        )
    payload = response.json()
    text = str(payload.get("text") or "").strip()
    return WorkflowTranscriptionResponse(text=text)


@router.post("/turn", response_model=WorkflowTurnResponse)
async def workflow_turn(
    body: WorkflowTurnRequest,
    user: AuthUser = Depends(get_current_user),
    db=Depends(get_db),
):
    if not get_ai_settings().orchestration_enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Orchestration disabled")

    trace = new_trace_id()
    ctx = context_from_auth_user(user, trace_id=trace)
    out = await get_orchestration_service().conversational_workflow_turn(
        ctx,
        db,
        user_message=body.message,
        workflow_state=body.workflow_state,
        client_session_id=body.client_session_id,
    )

    status_value = out.get("status") or "idle"
    workflow_phase = derive_workflow_phase(status_value)

    workflow_state = {
        "workflow_id": out.get("workflow_id"),
        "label": out.get("label"),
        "endpoint": out.get("endpoint"),
        "method": out.get("method"),
        "status": status_value,
        "workflow_phase": workflow_phase,
        "fields": out.get("fields") or {},
        "missing_fields": out.get("missing_fields") or [],
        "active_field": out.get("active_field"),
        "metamask_required": bool(out.get("metamask_required")),
        "success_behavior": out.get("success_behavior"),
    }

    return WorkflowTurnResponse(
        trace_id=trace,
        workflow_id=out.get("workflow_id"),
        label=out.get("label"),
        endpoint=out.get("endpoint"),
        method=out.get("method"),
        status=status_value,
        workflow_phase=workflow_phase,
        message=out.get("response_message") or "",
        question=out.get("question"),
        active_field=out.get("active_field"),
        fields=out.get("fields") or {},
        missing_fields=out.get("missing_fields") or [],
        validation_errors=out.get("validation_errors") or {},
        actions=out.get("actions") or [],
        execution_actions=out.get("execution_actions") or [],
        metamask_required=bool(out.get("metamask_required")),
        success_behavior=out.get("success_behavior"),
        graph_thread_id=out.get("graph_thread_id"),
        workflow_state=workflow_state,
    )
