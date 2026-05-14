from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AgentHealthResponse(BaseModel):
    status: str
    components: dict[str, str]


class AgentRuntimeStatusResponse(BaseModel):
    orchestration_enabled: bool
    provider: str
    default_model: str
    provider_configured: bool
    graph: str
    investor_copilot: str | None = None
    property_owner_copilot: str | None = None
    tenant_copilot: str | None = None
    authenticated: bool | None = None
    platform_role: str | None = None
    llm_synthesis_enabled: bool | None = None
    llm_completion_ready: bool | None = None
    fallback_provider: str | None = None


class AgentOrchestrationPingRequest(BaseModel):
    """Optional hints for routing scaffolding (ignored by foundation graph for now)."""

    dashboard_surface: str | None = Field(default=None, max_length=64)
    graph_thread_id: str | None = Field(default=None, max_length=160)
    memory_thread_id: int | None = Field(default=None, ge=1)


class AgentOrchestrationPingResponse(BaseModel):
    trace_id: str
    graph_profile: str
    messages: list[dict[str, Any]]
    tool_results: list[dict[str, Any]]
    policy_error: str | None = None
    graph_thread_id: str | None = None


class AgentMemoryThreadCreate(BaseModel):
    title: str | None = Field(default=None, max_length=255)


class AgentMemoryThreadRead(BaseModel):
    id: int
    title: str | None
    created_at: Any
    message_count: int = 0


class AgentToolExecuteRequest(BaseModel):
    tool: str = Field(..., min_length=1, max_length=160)
    arguments: dict[str, Any] = Field(default_factory=dict)
    graph_thread_id: str | None = Field(default=None, max_length=160)
    memory_thread_id: int | None = Field(default=None, ge=1)


class AgentRoiFlowRequest(BaseModel):
    property_ids: list[int] = Field(default_factory=list, max_length=20)
