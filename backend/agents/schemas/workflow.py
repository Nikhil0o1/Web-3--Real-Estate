"""Contracts for deterministic conversational workflow turns."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

WorkflowPhase = Literal[
    "WAITING_FOR_INTENT",
    "WAITING_FOR_FIELD_INPUT",
    "PROCESSING_FIELD_INPUT",
    "EXECUTING_ACTION",
    "WORKFLOW_COMPLETED",
]


def derive_workflow_phase(status: str | None) -> WorkflowPhase:
    """Maps coarse LangGraph HTTP responses to UI/session phases (best-effort)."""
    s = (status or "idle").strip().lower()
    if s == "awaiting_fields":
        return "WAITING_FOR_FIELD_INPUT"
    if s == "ready":
        return "EXECUTING_ACTION"
    return "WAITING_FOR_INTENT"


class WorkflowTurnRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    client_session_id: str | None = Field(default=None, max_length=120)
    workflow_state: dict[str, Any] = Field(default_factory=dict)


class WorkflowTemplateRead(BaseModel):
    workflow_id: str
    label: str
    endpoint: str
    method: str
    roles: list[str]
    required_fields: list[str]
    metamask_required: bool
    success_behavior: str


class WorkflowTurnResponse(BaseModel):
    trace_id: str
    workflow_id: str | None = None
    label: str | None = None
    endpoint: str | None = None
    method: str | None = None
    status: Literal["idle", "awaiting_fields", "ready", "forbidden", "unknown"] = "idle"
    workflow_phase: WorkflowPhase = "WAITING_FOR_INTENT"
    message: str
    question: str | None = None
    active_field: str | None = None
    fields: dict[str, Any] = Field(default_factory=dict)
    missing_fields: list[str] = Field(default_factory=list)
    validation_errors: dict[str, str] = Field(default_factory=dict)
    actions: list[dict[str, Any]] = Field(default_factory=list)
    execution_actions: list[dict[str, Any]] = Field(default_factory=list)
    metamask_required: bool = False
    success_behavior: str | None = None
    graph_thread_id: str | None = None
    workflow_state: dict[str, Any] = Field(default_factory=dict)


class WorkflowTranscriptionStatus(BaseModel):
    enabled: bool


class WorkflowTranscriptionResponse(BaseModel):
    text: str
