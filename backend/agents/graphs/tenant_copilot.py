"""Tenant copilot graph on the unified LangGraph runtime."""
from __future__ import annotations

import time
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from backend.agents.context.session import OrchestrationContext
from backend.agents.cognition.hybrid_synthesis import hybrid_enhance_copilot_narrative
from backend.agents.copilot.tenant_intent import classify_tenant_intent
from backend.agents.copilot.tenant_narrative import build_tenant_narrative
from backend.agents.orchestration.postgres_checkpoint import PostgresCheckpointSaver
from backend.agents.prompts.context_builders import build_prompt_context_for_role
from backend.agents.prompts.tenant_copilot.system import build_tenant_copilot_system_prompt
from backend.agents.schemas.copilot import (
    CopilotCitation,
    InvestorCopilotStructuredResponse,
    RecommendedAction,
)
from backend.agents.schemas.investor_copilot_state import InvestorCopilotState
from backend.agents.tools.registry import get_tool_registry


def _ctx(state: InvestorCopilotState) -> OrchestrationContext:
    return OrchestrationContext(
        user_id=int(state["user_id"]),
        wallet_address=str(state["wallet_address"]),
        platform_role="tenant",
        trace_id=str(state.get("trace_id") or ""),
        dashboard_surface=None,
        extras={},
    )


def _trace(state: InvestorCopilotState, entry: dict[str, Any]) -> list[dict[str, Any]]:
    t = list(state.get("execution_trace") or [])
    t.append(entry)
    return t


def _progress(state: InvestorCopilotState, line: str) -> list[str]:
    p = list(state.get("stream_progress") or [])
    p.append(line)
    return p


async def node_load_context(state: InvestorCopilotState, *, config: RunnableConfig) -> dict:
    db = config.get("configurable", {}).get("orchestration_db")
    if db is None:
        return {
            "prompt_context": {},
            "stream_progress": _progress(state, "Missing DB connection for tenant context."),
        }
    t0 = time.perf_counter()
    cur = db.cursor(dictionary=True)
    try:
        bundle = build_prompt_context_for_role(
            cur,
            user_id=int(state["user_id"]),
            wallet_address=str(state["wallet_address"]),
            platform_role="tenant",
        )
    finally:
        cur.close()
    ms = int((time.perf_counter() - t0) * 1000)
    return {
        "prompt_context": bundle,
        "graph_profile": "tenant_copilot:v1",
        "stream_progress": _progress(state, "Tenant context bundle ready."),
        "execution_trace": _trace(
            state,
            {"step_type": "load_context", "ok": True, "error": None, "duration_ms": ms, "tool_name": "prompt_context"},
        ),
    }


async def node_classify_intent(state: InvestorCopilotState, *, config: RunnableConfig) -> dict:
    _ = config
    intent, slots = classify_tenant_intent(str(state.get("user_message") or ""))
    return {
        "intent": intent,
        "intent_slots": slots,
        "stream_progress": _progress(state, f"Classified tenant intent: {intent}."),
        "execution_trace": _trace(
            state,
            {"step_type": "classify_intent", "ok": True, "error": None, "duration_ms": 0, "tool_name": None},
        ),
    }


async def node_gather_analytics(state: InvestorCopilotState, *, config: RunnableConfig) -> dict:
    db = config.get("configurable", {}).get("orchestration_db")
    ctx = _ctx(state)
    reg = get_tool_registry()
    intent = str(state.get("intent") or "tenant_overview")
    working: dict[str, Any] = dict(state.get("working") or {})
    tool_results: list[dict[str, Any]] = list(state.get("tool_results") or [])
    trace = list(state.get("execution_trace") or [])
    prog = list(state.get("stream_progress") or [])

    async def _invoke(name: str, args: dict[str, Any], label: str) -> None:
        nonlocal prog, trace, tool_results
        prog.append(label)
        t0 = time.perf_counter()
        out = await reg.invoke(name, ctx, args, db=db)
        ms = int((time.perf_counter() - t0) * 1000)
        tool_results.append({"tool": name, "ok": out.ok, "data": out.data, "error": out.error})
        trace.append(
            {
                "step_type": "tool_invoke",
                "tool_name": name,
                "ok": out.ok,
                "error": out.error,
                "duration_ms": ms,
                "detail": {"phase": "gather_analytics"},
            }
        )
        if out.ok:
            working[name] = out.data

    await _invoke("tenant.get_tenant_payment_summary", {}, "Summarizing tenant payment history…")
    await _invoke("tenant.next_payment_reminder", {}, "Calculating next payment reminder…")

    if intent in {"payment_summary", "tenant_overview"}:
        await _invoke("tenant.analyze_payment_behavior", {"months": 6}, "Analyzing payment behavior consistency…")
        await _invoke("tenant.payment_history", {}, "Fetching recent payment entries…")
    if intent in {"rent_forecast", "tenant_overview", "rent_reminder"}:
        await _invoke("tenant.forecast_rent_obligations", {"months": 3}, "Forecasting rent obligations…")
    if intent in {"affordability_analysis", "tenant_overview"}:
        await _invoke("tenant.calculate_affordability_metrics", {}, "Computing affordability metrics…")
    if intent in {"rental_assistance", "tenant_overview"}:
        await _invoke("tenant.active_rentals", {}, "Gathering active-rental context…")
        await _invoke("tenant.list_properties", {}, "Scanning rent-enabled properties…")

    return {
        "working": working,
        "tool_results": tool_results,
        "execution_trace": trace,
        "stream_progress": prog,
    }


async def node_synthesize(state: InvestorCopilotState, *, config: RunnableConfig) -> dict:
    t_synth = time.perf_counter()
    intent = str(state.get("intent") or "tenant_overview")
    prompt_context = state.get("prompt_context") or {}
    working = state.get("working") or {}
    msg, reasoning = build_tenant_narrative(
        intent=intent,
        prompt_context=prompt_context,
        working=working,
    )
    memory_tail = config.get("configurable", {}).get("copilot_memory_tail") or []
    _ = build_tenant_copilot_system_prompt(
        prompt_context=prompt_context, intent=intent, memory_tail=memory_tail
    )

    facts_bundle: dict[str, Any] = {
        "intent": intent,
        "intent_slots": dict(state.get("intent_slots") or {}),
        "payment_summary": working.get("tenant.get_tenant_payment_summary"),
        "next_payment": working.get("tenant.next_payment_reminder"),
        "payment_behavior": working.get("tenant.analyze_payment_behavior"),
        "payment_history": working.get("tenant.payment_history"),
        "rent_forecast": working.get("tenant.forecast_rent_obligations"),
        "affordability": working.get("tenant.calculate_affordability_metrics"),
        "active_rentals": working.get("tenant.active_rentals"),
        "tool_results_tail": (state.get("tool_results") or [])[-16:],
    }
    llm_msg, llm_reason, llm_warnings, llm_traces = await hybrid_enhance_copilot_narrative(
        role="tenant",
        config=config,
        user_message=str(state.get("user_message") or ""),
        intent=intent,
        template_message=msg,
        template_reasoning=reasoning,
        facts_bundle=facts_bundle,
        trace_id=str(state.get("trace_id") or ""),
        user_id=int(state.get("user_id") or 0) or None,
    )
    msg, reasoning = llm_msg, llm_reason

    actions = [
        RecommendedAction(
            action_id="open_tenant_payments",
            title="Open tenant payments",
            rationale="Review payment history and transaction-level detail.",
            requires_wallet=False,
        ),
        RecommendedAction(
            action_id="open_tenant_rentals",
            title="Open tenant rentals",
            rationale="Inspect active rentals and prepare next rent payment.",
            requires_wallet=False,
        ),
    ]
    citations = [
        CopilotCitation(source="prompt_context:tenant", detail="Role-scoped tenant context"),
        CopilotCitation(source="tool:tenant.get_tenant_payment_summary", detail="Payment summary baseline"),
        CopilotCitation(source="tool:tenant.next_payment_reminder", detail="Reminder and due signal"),
    ]
    if working.get("tenant.calculate_affordability_metrics"):
        citations.append(
            CopilotCitation(source="tool:tenant.calculate_affordability_metrics", detail="Affordability calculation")
        )
    citations.append(
        CopilotCitation(
            source="cognition:hybrid_llm",
            detail="Governed frontier narrative over deterministic tenant analytics.",
        )
    )

    warnings = list(state.get("pending_copilot_warnings") or [])
    warnings.extend(llm_warnings)

    structured = InvestorCopilotStructuredResponse(
        message=msg,
        reasoning_summary=reasoning,
        recommended_actions=actions,
        tool_results=list(state.get("tool_results") or []),
        analytics_summary={
            "intent": intent,
            "intent_slots": dict(state.get("intent_slots") or {}),
            "payment_summary": working.get("tenant.get_tenant_payment_summary"),
            "next_payment": working.get("tenant.next_payment_reminder"),
            "affordability": working.get("tenant.calculate_affordability_metrics"),
        },
        prepared_transactions=[],
        warnings=warnings,
        citations=citations,
        intent=intent,
        stream_progress=list(state.get("stream_progress") or [])
        + ["Hybrid cognition: rental intelligence narrative refinement…", "Synthesized tenant structured response."],
    )
    synth_ms = int((time.perf_counter() - t_synth) * 1000)
    base_trace = list(state.get("execution_trace") or [])
    base_trace.extend(llm_traces)
    base_trace.append(
        {
            "step_type": "synthesize",
            "ok": True,
            "error": None,
            "duration_ms": synth_ms,
            "tool_name": None,
            "detail": {"hybrid_llm": True},
        }
    )
    return {
        "structured_response": structured.model_dump(mode="json"),
        "execution_trace": base_trace,
    }


_tenant_copilot_compiled = None


def build_tenant_copilot_graph():
    global _tenant_copilot_compiled
    if _tenant_copilot_compiled is None:
        b = StateGraph(InvestorCopilotState)
        b.add_node("load_context", node_load_context)
        b.add_node("classify_intent", node_classify_intent)
        b.add_node("gather_analytics", node_gather_analytics)
        b.add_node("synthesize", node_synthesize)
        b.add_edge(START, "load_context")
        b.add_edge("load_context", "classify_intent")
        b.add_edge("classify_intent", "gather_analytics")
        b.add_edge("gather_analytics", "synthesize")
        b.add_edge("synthesize", END)
        _tenant_copilot_compiled = b.compile(checkpointer=PostgresCheckpointSaver())
    return _tenant_copilot_compiled
