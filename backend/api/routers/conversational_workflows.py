"""Conversational workflow automation API.

This router exposes deterministic workflow turns for voice and text clients. It
returns typed frontend actions only; existing product endpoints and MetaMask
flows remain the execution boundary.
"""
from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

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
)
from backend.agents.workflows.templates import list_workflow_templates
from backend.api.deps import get_current_user, get_db
from backend.services.auth import AuthUser, canonical_role

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

    workflow_state = {
        "workflow_id": out.get("workflow_id"),
        "label": out.get("label"),
        "endpoint": out.get("endpoint"),
        "method": out.get("method"),
        "status": out.get("status") or "idle",
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
        status=out.get("status") or "idle",
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
