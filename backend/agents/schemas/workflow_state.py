"""LangGraph state for deterministic conversational workflow automation."""
from __future__ import annotations

from typing import Any, TypedDict


class ConversationalWorkflowState(TypedDict, total=False):
    user_id: int
    wallet_address: str
    platform_role: str
    trace_id: str
    client_session_id: str
    user_message: str
    incoming_state: dict[str, Any]
    workflow_id: str | None
    label: str | None
    endpoint: str | None
    method: str | None
    status: str
    fields: dict[str, Any]
    missing_fields: list[str]
    validation_errors: dict[str, str]
    active_field: str | None
    actions: list[dict[str, Any]]
    execution_actions: list[dict[str, Any]]
    response_message: str
    question: str | None
    metamask_required: bool
    success_behavior: str | None
    execution_trace: list[dict[str, Any]]
