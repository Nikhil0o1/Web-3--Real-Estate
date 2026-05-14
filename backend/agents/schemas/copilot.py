"""Structured Investor Copilot API contracts (Phase 3)."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CopilotCitation(BaseModel):
    source: str = Field(..., description="e.g. tool:investor.portfolio")
    detail: str = Field(default="", description="Short factual anchor")


class RecommendedAction(BaseModel):
    action_id: str
    title: str
    rationale: str
    requires_wallet: bool = True


class PreparedTransaction(BaseModel):
    tool: str = Field(..., description="Tool that produced the payload, e.g. tx.prepare_investment")
    ok: bool
    error: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)


class InvestorCopilotChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    thread_id: int | None = Field(
        default=None,
        ge=1,
        description="Existing memory thread; omit to start a new conversation.",
    )
    title: str | None = Field(default=None, max_length=255, description="Title when creating a new thread.")


class InvestorCopilotStructuredResponse(BaseModel):
    """Actionable intelligence for the frontend — not a raw LLM blob."""

    message: str
    reasoning_summary: str
    recommended_actions: list[RecommendedAction] = Field(default_factory=list)
    tool_results: list[dict[str, Any]] = Field(default_factory=list)
    analytics_summary: dict[str, Any] = Field(default_factory=dict)
    prepared_transactions: list[PreparedTransaction] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    citations: list[CopilotCitation] = Field(default_factory=list)
    intent: str = "general"
    stream_progress: list[str] = Field(default_factory=list)


class InvestorCopilotChatResponse(BaseModel):
    trace_id: str
    thread_id: int
    structured: InvestorCopilotStructuredResponse
