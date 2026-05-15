"""Facade over runtime, config, and health for API + future workers."""
from __future__ import annotations

from functools import lru_cache
from typing import Any

from backend.agents.config.providers import get_completion_router
from backend.agents.config.settings import get_ai_settings
from backend.agents.context.session import OrchestrationContext
from backend.agents.memory.postgres import PostgresAgentMemoryStore
from backend.agents.observability.logging import get_agent_logger, log_orchestration_event
from backend.agents.runtime.executor import AgentRuntime
from backend.agents.tools.registry import get_tool_registry

_LOGGER = get_agent_logger("orchestrator.service")


class OrchestrationService:
    def __init__(self) -> None:
        self._settings = get_ai_settings()
        self._runtime = AgentRuntime()

    def health_components(self, db_conn) -> dict[str, str]:
        components: dict[str, str] = {"langgraph": "ok", "tool_registry": "ok"}
        try:
            get_tool_registry()
        except Exception as exc:  # noqa: BLE001
            components["tool_registry"] = f"error:{exc}"
        try:
            cur = db_conn.cursor()
            cur.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = 'agent_orchestration_threads' LIMIT 1"
            )
            row = cur.fetchone()
            cur.close()
            components["memory_tables"] = "ok" if row else "missing"
        except Exception as exc:  # noqa: BLE001
            components["memory_tables"] = f"error:{exc}"
        try:
            from langgraph.graph import StateGraph  # noqa: F401 — import check

            _ = StateGraph
        except Exception as exc:  # noqa: BLE001
            components["langgraph"] = f"error:{exc}"
        try:
            cur = db_conn.cursor()
            cur.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = 'agent_lg_checkpoints' LIMIT 1"
            )
            row = cur.fetchone()
            cur.close()
            components["orchestration_checkpoint_tables"] = "ok" if row else "missing"
        except Exception as exc:  # noqa: BLE001
            components["orchestration_checkpoint_tables"] = f"error:{exc}"
        return components

    def runtime_status(self) -> dict[str, Any]:
        settings = self._settings
        router = get_completion_router()
        llm_ready = router.any_configured()
        return {
            "orchestration_enabled": settings.orchestration_enabled,
            "provider": settings.provider,
            "default_model": settings.default_model,
            "provider_configured": llm_ready,
            "llm_synthesis_enabled": settings.ai_llm_synthesis_enabled,
            "llm_completion_ready": llm_ready,
            "fallback_provider": settings.fallback_provider,
            "graph": "foundation:v2",
            "investor_copilot": "investor_copilot:v1",
            "property_owner_copilot": "property_owner_copilot:v1",
            "tenant_copilot": "tenant_copilot:v1",
            "conversational_workflow": "conversational_workflow:v1",
        }

    async def ping(
        self,
        ctx: OrchestrationContext,
        *,
        dashboard_surface: str | None,
        db: Any,
        graph_thread_id: str | None = None,
        memory_thread_id: int | None = None,
    ) -> dict[str, Any]:
        log_orchestration_event(_LOGGER, "orchestration_ping", trace_id=ctx.trace_id, extra=ctx.as_log_extra())
        return await self._runtime.run_foundation(
            ctx,
            dashboard_surface=dashboard_surface,
            db=db,
            graph_thread_id=graph_thread_id,
            memory_thread_id=memory_thread_id,
        )

    async def execute_tool_via_graph(
        self,
        ctx: OrchestrationContext,
        db: Any,
        tool: str,
        arguments: dict[str, Any],
        *,
        graph_thread_id: str | None = None,
        memory_thread_id: int | None = None,
    ) -> dict[str, Any]:
        """Single entry for tool execution — always through the LangGraph runtime."""
        return await self._runtime.run_orchestration(
            ctx,
            db,
            dashboard_surface=ctx.dashboard_surface,
            execution_mode="tool_execute",
            target_tool=tool,
            target_arguments=arguments,
            graph_thread_id=graph_thread_id,
            memory_thread_id=memory_thread_id,
        )

    async def conversational_workflow_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        workflow_state: dict[str, Any],
        client_session_id: str | None = None,
    ) -> dict[str, Any]:
        return await self._runtime.run_conversational_workflow_turn(
            ctx,
            db,
            user_message=user_message,
            workflow_state=workflow_state,
            client_session_id=client_session_id,
        )

    async def investor_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return await self._runtime.run_investor_copilot_turn(
            ctx,
            db,
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        )

    async def investor_copilot_stream(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ):
        async for ev in self._runtime.astream_investor_copilot_turn(
            ctx,
            db,
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        ):
            yield ev

    async def property_owner_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return await self._runtime.run_property_owner_copilot_turn(
            ctx,
            db,
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        )

    async def property_owner_copilot_stream(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ):
        async for ev in self._runtime.astream_property_owner_copilot_turn(
            ctx,
            db,
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        ):
            yield ev

    async def tenant_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return await self._runtime.run_tenant_copilot_turn(
            ctx,
            db,
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        )

    async def tenant_copilot_stream(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ):
        async for ev in self._runtime.astream_tenant_copilot_turn(
            ctx,
            db,
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        ):
            yield ev

    def memory_store(self, db_conn) -> PostgresAgentMemoryStore:
        return PostgresAgentMemoryStore(db_conn)


@lru_cache
def get_orchestration_service() -> OrchestrationService:
    return OrchestrationService()
