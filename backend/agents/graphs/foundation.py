"""Unified LangGraph — single orchestration path (ping, tool execution, future copilot)."""
from __future__ import annotations

import time
from typing import Literal

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from backend.agents.context.session import OrchestrationContext
from backend.agents.orchestration.policies import evaluate_tool_execution, execution_budget_stub
from backend.agents.orchestration.postgres_checkpoint import PostgresCheckpointSaver
from backend.agents.schemas.state import FoundationGraphState
from backend.agents.tools.registry import get_tool_registry


def _ctx_from_state(state: FoundationGraphState) -> OrchestrationContext:
    return OrchestrationContext(
        user_id=int(state["user_id"]),
        wallet_address=str(state["wallet_address"]),
        platform_role=str(state["platform_role"]),
        trace_id=str(state.get("trace_id") or ""),
        dashboard_surface=state.get("dashboard_surface"),
        extras={},
    )


async def policy_node(state: FoundationGraphState, *, config: RunnableConfig) -> dict:
    t0 = time.perf_counter()
    reg = get_tool_registry()
    mode = state.get("execution_mode") or "ping"
    tool_name = state.get("target_tool") or "orchestration.ping"
    spec = reg.get_spec(tool_name)
    ctx = _ctx_from_state(state)
    cap_val = spec.meta.capability.value if spec else None
    budget = execution_budget_stub(ctx, tool_name)
    trace = list(state.get("execution_trace") or [])
    ms = int((time.perf_counter() - t0) * 1000)
    if not budget.allowed:
        trace.append(
            {
                "step_type": "policy",
                "tool_name": tool_name,
                "capability": cap_val,
                "ok": False,
                "error": budget.reason,
                "duration_ms": ms,
                "detail": {"gate": "budget"},
            }
        )
        return {"policy_error": budget.reason or "POLICY_DENIED", "execution_trace": trace}
    outcome = evaluate_tool_execution(ctx, spec, execution_mode=str(mode))
    trace.append(
        {
            "step_type": "policy",
            "tool_name": tool_name,
            "capability": cap_val,
            "ok": outcome.allowed,
            "error": outcome.reason,
            "duration_ms": ms,
            "detail": {"gate": "role_capability"},
        }
    )
    if not outcome.allowed:
        return {"policy_error": outcome.reason or "POLICY_DENIED", "execution_trace": trace}
    return {"policy_error": None, "execution_trace": trace}


def route_after_policy(state: FoundationGraphState) -> Literal["blocked", "invoke"]:
    return "blocked" if state.get("policy_error") else "invoke"


async def invoke_tool_node(state: FoundationGraphState, *, config: RunnableConfig) -> dict:
    if state.get("policy_error"):
        return {}
    t0 = time.perf_counter()
    db = config.get("configurable", {}).get("orchestration_db")
    reg = get_tool_registry()
    tool_name = state.get("target_tool") or "orchestration.ping"
    args = dict(state.get("target_arguments") or {})
    ctx = _ctx_from_state(state)
    tool_out = await reg.invoke(tool_name, ctx, args, db=db)
    ms = int((time.perf_counter() - t0) * 1000)
    spec = reg.get_spec(tool_name)
    cap = spec.meta.capability.value if spec else "unknown"
    trace = list(state.get("execution_trace") or [])
    trace.append(
        {
            "step_type": "tool_invoke",
            "tool_name": tool_name,
            "capability": cap,
            "ok": tool_out.ok,
            "error": tool_out.error,
            "duration_ms": ms,
            "detail": {"execution_mode": state.get("execution_mode")},
        }
    )
    tool_results = list(state.get("tool_results") or [])
    tool_results.append(
        {"tool": tool_name, "ok": tool_out.ok, "data": tool_out.data, "error": tool_out.error},
    )
    return {
        "tool_results": tool_results,
        "execution_trace": trace,
        "stream_seq": int(state.get("stream_seq") or 0) + 1,
    }


async def finalize_node(state: FoundationGraphState, *, config: RunnableConfig) -> dict:
    _ = config
    messages = list(state.get("messages") or [])
    mode = state.get("execution_mode") or "ping"
    pol_err = state.get("policy_error")
    tool_results = list(state.get("tool_results") or [])
    if pol_err:
        tool_name = state.get("target_tool") or "orchestration.ping"
        tool_results.append({"tool": tool_name, "ok": False, "error": pol_err, "data": {}})
        assistant = {
            "role": "assistant",
            "content": "orchestration_blocked",
            "graph_profile": state.get("graph_profile", ""),
            "policy_error": pol_err,
        }
    else:
        assistant = {
            "role": "assistant",
            "content": "foundation_graph_complete",
            "graph_profile": state.get("graph_profile", ""),
            "execution_mode": mode,
        }
    messages.append(assistant)
    trace = list(state.get("execution_trace") or [])
    trace.append(
        {
            "step_type": "finalize",
            "tool_name": None,
            "capability": None,
            "ok": True,
            "error": None,
            "duration_ms": 0,
            "detail": {},
        },
    )
    meta = dict(state.get("orchestration_meta") or {})
    meta["orchestration_phase"] = "2.5"
    return {
        "messages": messages,
        "tool_results": tool_results,
        "execution_trace": trace,
        "orchestration_meta": meta,
        "stream_seq": int(state.get("stream_seq") or 0) + 1,
    }


_compiled = None


def build_foundation_graph():
    """Return a compiled graph singleton (Postgres checkpoints, unified nodes)."""
    global _compiled
    if _compiled is None:
        builder = StateGraph(FoundationGraphState)
        builder.add_node("policy", policy_node)
        builder.add_node("invoke_tool", invoke_tool_node)
        builder.add_node("finalize", finalize_node)
        builder.add_edge(START, "policy")
        builder.add_conditional_edges(
            "policy",
            route_after_policy,
            {"blocked": "finalize", "invoke": "invoke_tool"},
        )
        builder.add_edge("invoke_tool", "finalize")
        builder.add_edge("finalize", END)
        _compiled = builder.compile(checkpointer=PostgresCheckpointSaver())
    return _compiled
