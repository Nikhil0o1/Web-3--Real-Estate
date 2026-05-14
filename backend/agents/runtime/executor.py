"""Async agent runtime — unified LangGraph execution + trace isolation."""
from __future__ import annotations

from typing import Any, Literal

from backend.agents.config.settings import get_ai_settings
from backend.agents.context.role_router import resolve_graph_profile
from backend.agents.context.session import OrchestrationContext
from backend.agents.graphs.foundation import build_foundation_graph
from backend.agents.graphs.investor_copilot import build_investor_copilot_graph
from backend.agents.graphs.property_owner_copilot import build_property_owner_copilot_graph
from backend.agents.graphs.tenant_copilot import build_tenant_copilot_graph
from backend.agents.observability.logging import get_agent_logger, log_orchestration_event
from backend.agents.orchestration.audit import persist_orchestration_run
from backend.agents.schemas.investor_copilot_state import InvestorCopilotState
from backend.agents.schemas.state import FoundationGraphState

_LOGGER = get_agent_logger("runtime.executor")


def _graph_thread_key(
    ctx: OrchestrationContext,
    *,
    graph_thread_id: str | None,
    memory_thread_id: int | None,
) -> tuple[str, int | None]:
    """Bind LangGraph thread_id ↔ memory thread ↔ trace (HTTP trace stays in state)."""
    if graph_thread_id and graph_thread_id.strip():
        safe = graph_thread_id.strip()[:160]
        return f"u{ctx.user_id}-g-{safe}", memory_thread_id
    if memory_thread_id is not None:
        return f"u{ctx.user_id}-m-{int(memory_thread_id)}", int(memory_thread_id)
    return f"u{ctx.user_id}-t-{ctx.trace_id}", None


CopilotRole = Literal["investor", "property_owner", "tenant"]


def _copilot_graph(role: CopilotRole):
    if role == "investor":
        return build_investor_copilot_graph()
    if role == "property_owner":
        return build_property_owner_copilot_graph()
    return build_tenant_copilot_graph()


class AgentRuntime:
    """Unified LangGraph lifecycle — ping, tool execution, and future copilot modes."""

    def __init__(self) -> None:
        self._settings = get_ai_settings()

    async def run_orchestration(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        dashboard_surface: str | None,
        execution_mode: Literal["ping", "tool_execute"],
        target_tool: str | None = None,
        target_arguments: dict[str, Any] | None = None,
        graph_thread_id: str | None = None,
        memory_thread_id: int | None = None,
    ) -> dict[str, Any]:
        if not self._settings.orchestration_enabled:
            return {"disabled": True, "messages": [], "tool_results": [], "policy_error": None}

        graph = build_foundation_graph()
        profile = resolve_graph_profile(ctx.platform_role, dashboard_surface)
        g_tid, mem_resolved = _graph_thread_key(
            ctx, graph_thread_id=graph_thread_id, memory_thread_id=memory_thread_id
        )
        tool_name = target_tool if execution_mode == "tool_execute" else "orchestration.ping"
        if execution_mode == "tool_execute" and not (tool_name or "").strip():
            return {
                "messages": [],
                "tool_results": [],
                "policy_error": "MISSING_TOOL_NAME",
                "graph_profile": profile,
            }

        initial: FoundationGraphState = {
            "messages": [],
            "user_id": ctx.user_id,
            "wallet_address": ctx.wallet_address,
            "platform_role": ctx.platform_role,
            "trace_id": ctx.trace_id,
            "graph_profile": profile,
            "dashboard_surface": dashboard_surface,
            "tool_results": [],
            "execution_mode": execution_mode,
            "target_tool": tool_name or "orchestration.ping",
            "target_arguments": dict(target_arguments or {}),
            "policy_error": None,
            "execution_trace": [],
            "orchestration_meta": {"graph_version": "foundation:v2"},
            "stream_seq": 0,
            "memory_thread_id": mem_resolved,
        }
        log_orchestration_event(
            _LOGGER,
            "graph_invoke_start",
            trace_id=ctx.trace_id,
            extra={"profile": profile, "mode": execution_mode, "graph_thread_id": g_tid},
        )
        config: dict[str, Any] = {
            "configurable": {
                "thread_id": g_tid,
                "checkpoint_ns": "",
                "orchestration_db": db,
            }
        }
        try:
            out = await graph.ainvoke(initial, config)
        finally:
            log_orchestration_event(_LOGGER, "graph_invoke_end", trace_id=ctx.trace_id, extra={"profile": profile})

        policy_ok = not out.get("policy_error")
        last_tr = (out.get("tool_results") or [])[-1] if out.get("tool_results") else None
        tool_ok = bool(last_tr.get("ok")) if isinstance(last_tr, dict) else False
        audit_ok = policy_ok and tool_ok

        try:
            persist_orchestration_run(
                trace_id=ctx.trace_id,
                graph_thread_id=g_tid,
                memory_thread_id=mem_resolved,
                user_id=ctx.user_id,
                execution_mode=execution_mode,
                graph_profile=profile,
                ok=audit_ok,
                error=out.get("policy_error") or (last_tr or {}).get("error"),
                execution_trace=list(out.get("execution_trace") or []),
                policies={"budget_stub": True, "role_capability": True},
            )
        except Exception as exc:  # noqa: BLE001 — audit must not break orchestration
            _LOGGER.warning("orchestration audit persist failed trace=%s err=%s", ctx.trace_id, exc)

        return {
            "messages": out.get("messages", []),
            "tool_results": out.get("tool_results", []),
            "graph_profile": profile,
            "policy_error": out.get("policy_error"),
            "execution_trace": out.get("execution_trace", []),
            "orchestration_meta": out.get("orchestration_meta", {}),
            "graph_thread_id": g_tid,
            "audit_ok": audit_ok,
        }

    async def run_foundation(
        self,
        ctx: OrchestrationContext,
        *,
        dashboard_surface: str | None = None,
        db: Any | None = None,
        graph_thread_id: str | None = None,
        memory_thread_id: int | None = None,
    ) -> dict[str, Any]:
        if db is None:
            _LOGGER.warning("run_foundation without db — tools needing DB will fail inside graph")
        return await self.run_orchestration(
            ctx,
            db,
            dashboard_surface=dashboard_surface,
            execution_mode="ping",
            graph_thread_id=graph_thread_id,
            memory_thread_id=memory_thread_id,
        )

    async def astream_orchestration_values(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        dashboard_surface: str | None = None,
        execution_mode: Literal["ping", "tool_execute"] = "ping",
        target_tool: str | None = None,
        target_arguments: dict[str, Any] | None = None,
        graph_thread_id: str | None = None,
        memory_thread_id: int | None = None,
    ):
        """Yield LangGraph ``astream`` value chunks as dicts (caller formats SSE)."""
        if not self._settings.orchestration_enabled:
            yield {"disabled": True}
            return
        graph = build_foundation_graph()
        profile = resolve_graph_profile(ctx.platform_role, dashboard_surface)
        g_tid, mem_resolved = _graph_thread_key(
            ctx, graph_thread_id=graph_thread_id, memory_thread_id=memory_thread_id
        )
        tool_name = target_tool if execution_mode == "tool_execute" else "orchestration.ping"
        initial: FoundationGraphState = {
            "messages": [],
            "user_id": ctx.user_id,
            "wallet_address": ctx.wallet_address,
            "platform_role": ctx.platform_role,
            "trace_id": ctx.trace_id,
            "graph_profile": profile,
            "dashboard_surface": dashboard_surface,
            "tool_results": [],
            "execution_mode": execution_mode,
            "target_tool": tool_name or "orchestration.ping",
            "target_arguments": dict(target_arguments or {}),
            "policy_error": None,
            "execution_trace": [],
            "orchestration_meta": {"graph_version": "foundation:v2"},
            "stream_seq": 0,
            "memory_thread_id": mem_resolved,
        }
        config: dict[str, Any] = {
            "configurable": {
                "thread_id": g_tid,
                "checkpoint_ns": "",
                "orchestration_db": db,
            }
        }
        try:
            async for chunk in graph.astream(initial, config, stream_mode="values"):
                yield {"stream_kind": "graph_values", "chunk": chunk}
        except Exception as exc:
            _LOGGER.exception("astream_orchestration_values failed trace=%s", ctx.trace_id)
            yield {"stream_kind": "error", "error": str(exc)}

    async def run_role_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        role: CopilotRole,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ) -> dict[str, Any]:
        if not self._settings.orchestration_enabled:
            return {"disabled": True, "structured_response": {}}
        graph = _copilot_graph(role)
        g_tid = f"u{ctx.user_id}-copilot-{role}-m-{int(memory_thread_id)}"
        initial: InvestorCopilotState = {
            "user_id": ctx.user_id,
            "wallet_address": ctx.wallet_address,
            "platform_role": role,
            "trace_id": ctx.trace_id,
            "memory_thread_id": int(memory_thread_id),
            "user_message": user_message,
            "tool_results": [],
            "execution_trace": [],
            "working": {},
            "stream_progress": [],
            "intent_slots": {},
            "ranked_recommendations": [],
            "pending_copilot_warnings": [],
        }
        log_orchestration_event(
            _LOGGER,
            f"{role}_copilot_start",
            trace_id=ctx.trace_id,
            extra={"role": role, "graph_thread_id": g_tid, "memory_thread_id": memory_thread_id},
        )
        config: dict[str, Any] = {
            "configurable": {
                "thread_id": g_tid,
                "checkpoint_ns": "",
                "orchestration_db": db,
                "copilot_memory_tail": memory_tail,
            }
        }
        try:
            out = await graph.ainvoke(initial, config)
        finally:
            log_orchestration_event(_LOGGER, f"{role}_copilot_end", trace_id=ctx.trace_id, extra={"role": role})

        structured = out.get("structured_response") or {}
        audit_ok = bool(structured)
        try:
            persist_orchestration_run(
                trace_id=ctx.trace_id,
                graph_thread_id=g_tid,
                memory_thread_id=int(memory_thread_id),
                user_id=ctx.user_id,
                execution_mode=f"{role}_copilot",
                graph_profile=str(out.get("graph_profile") or f"{role}_copilot:v1"),
                ok=audit_ok,
                error=None if audit_ok else "COPILOT_NO_STRUCTURED_OUTPUT",
                execution_trace=list(out.get("execution_trace") or []),
                policies={"copilot": True, "non_custodial": True, "role": role, "llm_hybrid": True},
            )
        except Exception as exc:  # noqa: BLE001
            _LOGGER.warning("copilot audit persist failed trace=%s err=%s", ctx.trace_id, exc)

        return {
            "structured_response": structured,
            "tool_results": out.get("tool_results", []),
            "execution_trace": out.get("execution_trace", []),
            "graph_thread_id": g_tid,
            "audit_ok": audit_ok,
        }

    async def astream_role_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        role: CopilotRole,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ):
        if not self._settings.orchestration_enabled:
            yield {"stream_kind": "disabled", "trace_id": ctx.trace_id}
            return
        graph = _copilot_graph(role)
        g_tid = f"u{ctx.user_id}-copilot-{role}-m-{int(memory_thread_id)}"
        initial: InvestorCopilotState = {
            "user_id": ctx.user_id,
            "wallet_address": ctx.wallet_address,
            "platform_role": role,
            "trace_id": ctx.trace_id,
            "memory_thread_id": int(memory_thread_id),
            "user_message": user_message,
            "tool_results": [],
            "execution_trace": [],
            "working": {},
            "stream_progress": [],
            "intent_slots": {},
            "ranked_recommendations": [],
            "pending_copilot_warnings": [],
        }
        config: dict[str, Any] = {
            "configurable": {
                "thread_id": g_tid,
                "checkpoint_ns": "",
                "orchestration_db": db,
                "copilot_memory_tail": memory_tail,
            }
        }
        last_values_state: dict[str, Any] = {}
        try:
            async for mode, chunk in graph.astream(
                initial, config, stream_mode=["updates", "custom", "values"]
            ):
                if mode == "updates":
                    yield {"stream_kind": "graph_updates", "trace_id": ctx.trace_id, "chunk": chunk}
                elif mode == "custom":
                    yield {"stream_kind": "cognition", "trace_id": ctx.trace_id, "chunk": chunk}
                elif mode == "values" and isinstance(chunk, dict):
                    # Full graph state after each step — reliable source for structured_response
                    # when checkpoint snapshots omit fields the SSE layer expects.
                    last_values_state = chunk
            snap = await graph.aget_state(config)
            out = dict(snap.values) if snap and getattr(snap, "values", None) else {}
        except Exception as exc:
            _LOGGER.exception("astream_%s_copilot failed trace=%s", role, ctx.trace_id)
            yield {"stream_kind": "error", "trace_id": ctx.trace_id, "error": str(exc)}
            out = {}
            last_values_state = {}
        # LangGraph "updates" chunks may not surface ``structured_response`` in a shape the
        # SSE routers parse; always emit one terminal update from checkpoint state for the UI.
        structured_from_snap = out.get("structured_response")
        structured_from_values = last_values_state.get("structured_response")
        structured: dict[str, Any] = {}
        if isinstance(structured_from_snap, dict) and structured_from_snap:
            structured = structured_from_snap
        elif isinstance(structured_from_values, dict) and structured_from_values:
            structured = structured_from_values
        if structured:
            yield {
                "stream_kind": "graph_updates",
                "trace_id": ctx.trace_id,
                "chunk": {"__terminal__": {"structured_response": structured}},
            }
        audit_ok = bool(structured)
        try:
            persist_orchestration_run(
                trace_id=ctx.trace_id,
                graph_thread_id=g_tid,
                memory_thread_id=int(memory_thread_id),
                user_id=ctx.user_id,
                execution_mode=f"{role}_copilot_stream",
                graph_profile=str(
                    out.get("graph_profile") or last_values_state.get("graph_profile") or f"{role}_copilot:v1"
                ),
                ok=audit_ok,
                error=None if audit_ok else "COPILOT_STREAM_INCOMPLETE",
                execution_trace=list(out.get("execution_trace") or []),
                policies={"copilot": True, "non_custodial": True, "streaming": True, "role": role, "llm_hybrid": True},
            )
        except Exception as exc:  # noqa: BLE001
            _LOGGER.warning("copilot stream audit persist failed trace=%s err=%s", ctx.trace_id, exc)

    async def run_investor_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return await self.run_role_copilot_turn(
            ctx,
            db,
            role="investor",
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        )

    async def run_property_owner_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return await self.run_role_copilot_turn(
            ctx,
            db,
            role="property_owner",
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        )

    async def run_tenant_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return await self.run_role_copilot_turn(
            ctx,
            db,
            role="tenant",
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        )

    async def astream_investor_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ):
        async for ev in self.astream_role_copilot_turn(
            ctx,
            db,
            role="investor",
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        ):
            yield ev

    async def astream_property_owner_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ):
        async for ev in self.astream_role_copilot_turn(
            ctx,
            db,
            role="property_owner",
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        ):
            yield ev

    async def astream_tenant_copilot_turn(
        self,
        ctx: OrchestrationContext,
        db: Any,
        *,
        user_message: str,
        memory_thread_id: int,
        memory_tail: list[dict[str, Any]],
    ):
        async for ev in self.astream_role_copilot_turn(
            ctx,
            db,
            role="tenant",
            user_message=user_message,
            memory_thread_id=memory_thread_id,
            memory_tail=memory_tail,
        ):
            yield ev
