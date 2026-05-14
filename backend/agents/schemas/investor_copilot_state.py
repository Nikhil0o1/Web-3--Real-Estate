"""LangGraph channel state for the Investor Copilot graph."""
from __future__ import annotations

from typing import Any, TypedDict


class InvestorCopilotState(TypedDict, total=False):
    user_id: int
    wallet_address: str
    platform_role: str
    trace_id: str
    memory_thread_id: int
    user_message: str
    prompt_context: dict[str, Any]
    intent: str
    intent_slots: dict[str, Any]
    working: dict[str, Any]
    tool_results: list[dict[str, Any]]
    execution_trace: list[dict[str, Any]]
    ranked_recommendations: list[dict[str, Any]]
    structured_response: dict[str, Any]
    stream_progress: list[str]
    graph_profile: str
    pending_copilot_warnings: list[str]
    prepared_transactions: list[dict[str, Any]]
