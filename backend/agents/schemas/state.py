"""LangGraph state shapes (unified orchestration graph)."""
from __future__ import annotations

from typing import Any, Literal, TypedDict


class FoundationGraphState(TypedDict, total=False):
    """Persisted orchestration state (LangGraph channels + explicit Phase 2.5 fields)."""

    messages: list[dict[str, Any]]
    user_id: int
    wallet_address: str
    platform_role: str
    trace_id: str
    graph_profile: str
    dashboard_surface: str | None
    tool_results: list[dict[str, Any]]
    execution_mode: Literal["ping", "tool_execute"]
    target_tool: str
    target_arguments: dict[str, Any]
    policy_error: str | None
    execution_trace: list[dict[str, Any]]
    orchestration_meta: dict[str, Any]
    stream_seq: int
    memory_thread_id: int | None
