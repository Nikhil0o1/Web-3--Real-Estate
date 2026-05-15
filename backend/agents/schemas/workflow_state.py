"""LangGraph state for deterministic conversational workflow automation."""
from __future__ import annotations

from typing import Annotated, Any, TypedDict


def _incoming_state_reducer(
    _previous: dict[str, Any] | None,
    update: dict[str, Any] | None,
) -> dict[str, Any]:
    """Replace client snapshot each HTTP turn.

    LangGraph's default dict merge keeps stale keys from Postgres checkpoints, so an
    ``incoming_state`` of ``{}`` would previously retain ``workflow_id`` from an older
    turn and block intent matching (e.g. ``invest`` / ``create a new property``).
    """
    if update is not None:
        return dict(update)
    return dict(_previous or {})


class ConversationalWorkflowState(TypedDict, total=False):
    user_id: int
    wallet_address: str
    platform_role: str
    trace_id: str
    client_session_id: str
    user_message: str
    incoming_state: Annotated[dict[str, Any], _incoming_state_reducer]
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
