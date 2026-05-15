"""Conversational workflow automation API.

This router exposes deterministic workflow turns for voice and text clients. It
returns typed frontend actions only; existing product endpoints and MetaMask
flows remain the execution boundary.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from backend.agents.config.settings import get_ai_settings
from backend.agents.context.session import context_from_auth_user
from backend.agents.observability.logging import new_trace_id
from backend.agents.orchestrator.service import get_orchestration_service
from backend.agents.schemas.workflow import (
    WorkflowTemplateRead,
    WorkflowTurnRequest,
    WorkflowTurnResponse,
)
from backend.agents.workflows.templates import list_workflow_templates
from backend.api.deps import get_current_user, get_db
from backend.services.auth import AuthUser

router = APIRouter(prefix="/workflows", tags=["conversational-workflows"])


@router.get("/templates", response_model=list[WorkflowTemplateRead])
def workflow_templates(user: AuthUser = Depends(get_current_user)):
    role = user.role
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
