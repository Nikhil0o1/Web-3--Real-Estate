"""Pydantic schemas for the AI API surface."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


Role = Literal["user", "assistant", "system", "tool"]


class ChatMessage(BaseModel):
    role: Role
    content: str = ""
    # Optional tool-call metadata so the frontend can persist & replay a thread.
    tool_call_id: str | None = None
    name: str | None = None


class AgentAction(BaseModel):
    """A UI action the frontend should execute after rendering the reply."""
    type: Literal[
        "NAVIGATE",
        "OPEN_MODAL",
        "FOCUS_FIELD",
        "FILL_FIELD",
        "SUBMIT_FORM",
    ]
    route: str | None = None
    modal: str | None = None
    field: str | None = None
    value: str | None = None
    property_id: int | str | None = None


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    # Optional client-side trace id for debugging.
    client_session_id: str | None = None
    # Optional thread id for resuming checkpointed conversations.
    thread_id: str | None = None


class InterruptResponse(BaseModel):
    """Returned when the agent pauses for user confirmation before a high-stakes action."""
    message: str
    pending_actions: list[AgentAction] = Field(default_factory=list)
    thread_id: str


class ChatResponse(BaseModel):
    reply: str
    actions: list[AgentAction] = Field(default_factory=list)
    messages: list[ChatMessage] = Field(default_factory=list)
    role: str
    model: str
    # If present, the agent is waiting for user confirmation.
    interrupt: InterruptResponse | None = None


class VoiceStatusResponse(BaseModel):
    stt_enabled: bool
    tts_enabled: bool
    tts_provider: str


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    voice: str | None = None


class ResumeRequest(BaseModel):
    """Resume a previously interrupted conversation."""
    thread_id: str
    approve: bool
    client_session_id: str | None = None


class TranscriptionResponse(BaseModel):
    text: str


# Internal: a tool result that the agent loop pipes back to the LLM.
class ToolResult(BaseModel):
    ok: bool
    data: Any = None
    error: str | None = None
    # UI actions a tool can request the frontend to execute.
    actions: list[AgentAction] = Field(default_factory=list)
