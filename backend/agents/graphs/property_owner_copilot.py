"""Property-owner copilot graph on the unified LangGraph runtime."""
from __future__ import annotations

import time
from decimal import Decimal
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from backend.agents.context.session import OrchestrationContext
from backend.agents.cognition.hybrid_synthesis import hybrid_enhance_copilot_narrative
from backend.agents.copilot.execution_router import enrich_intent_slots_with_execution_route
from backend.agents.copilot.property_owner_intent import classify_property_owner_intent
from backend.agents.copilot.property_owner_narrative import build_property_owner_narrative
from backend.agents.copilot.recommendation_ranker import rank_investment_opportunities
from backend.agents.copilot.tx_slot_hints import parse_token_amount
from backend.agents.orchestration.postgres_checkpoint import PostgresCheckpointSaver
from backend.agents.prompts.context_builders import build_prompt_context_for_role
from backend.agents.prompts.property_owner_copilot.system import (
    build_property_owner_copilot_system_prompt,
)
from backend.agents.schemas.copilot import (
    CopilotCitation,
    InvestorCopilotStructuredResponse,
    PreparedTransaction,
    RecommendedAction,
)
from backend.agents.schemas.investor_copilot_state import InvestorCopilotState
from backend.agents.tools.registry import get_tool_registry


def _ctx(state: InvestorCopilotState) -> OrchestrationContext:
    return OrchestrationContext(
        user_id=int(state["user_id"]),
        wallet_address=str(state["wallet_address"]),
        platform_role="property_owner",
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
            "stream_progress": _progress(state, "Missing DB connection for property-owner context."),
        }
    t0 = time.perf_counter()
    cur = db.cursor(dictionary=True)
    try:
        bundle = build_prompt_context_for_role(
            cur,
            user_id=int(state["user_id"]),
            wallet_address=str(state["wallet_address"]),
            platform_role="property_owner",
        )
    finally:
        cur.close()
    ms = int((time.perf_counter() - t0) * 1000)
    return {
        "prompt_context": bundle,
        "graph_profile": "property_owner_copilot:v1",
        "stream_progress": _progress(state, "Property-owner context bundle ready."),
        "execution_trace": _trace(
            state,
            {"step_type": "load_context", "ok": True, "error": None, "duration_ms": ms, "tool_name": "prompt_context"},
        ),
    }


async def node_classify_intent(state: InvestorCopilotState, *, config: RunnableConfig) -> dict:
    _ = config
    intent, slots = classify_property_owner_intent(str(state.get("user_message") or ""))
    slots = enrich_intent_slots_with_execution_route(
        role="property_owner",
        user_message=str(state.get("user_message") or ""),
        intent_label=intent,
        slots=slots,
    )
    return {
        "intent": intent,
        "intent_slots": slots,
        "stream_progress": _progress(
            state,
            f"Classified property-owner intent: {intent} (mode={slots.get('interaction_mode', 'advisory')}).",
        ),
        "execution_trace": _trace(
            state,
            {"step_type": "classify_intent", "ok": True, "error": None, "duration_ms": 0, "tool_name": None},
        ),
    }


async def node_gather_analytics(state: InvestorCopilotState, *, config: RunnableConfig) -> dict:
    db = config.get("configurable", {}).get("orchestration_db")
    ctx = _ctx(state)
    reg = get_tool_registry()
    intent = str(state.get("intent") or "operations_overview")
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

    await _invoke("owner.get_property_operational_metrics", {}, "Loading property operational metrics…")

    if intent == "invest_prepare":
        await _invoke("investor.portfolio", {"refresh": False}, "Loading wallet portfolio for invest flow…")
        await _invoke("marketplace.low_risk_properties", {"limit": 10}, "Scanning lower-risk marketplace cohort…")
        await _invoke("marketplace.top_yielding_properties", {"limit": 10}, "Ranking yield-proxy leaders…")
        await _invoke("investor.passive_income_metrics", {}, "Summarizing passive income metrics…")

    if intent in {"occupancy_analysis", "operations_overview"}:
        await _invoke("owner.analyze_occupancy_trends", {"months": 6}, "Analyzing occupancy trends…")
    if intent in {"underperforming_detection", "operations_overview"}:
        await _invoke("owner.detect_underperforming_properties", {}, "Detecting underperforming properties…")
    if intent in {"revenue_forecast", "operations_overview"}:
        await _invoke("owner.forecast_property_revenue", {"months": 3}, "Forecasting property revenue…")
    if intent in {"investor_participation", "operations_overview"}:
        await _invoke("owner.analyze_investor_distribution", {}, "Analyzing investor participation distribution…")
    if intent in {"pricing_optimization", "operations_overview"}:
        await _invoke("owner.suggest_pricing_improvements", {}, "Generating pricing optimization suggestions…")

    return {
        "working": working,
        "tool_results": tool_results,
        "execution_trace": trace,
        "stream_progress": prog,
    }


async def node_rank(state: InvestorCopilotState, *, config: RunnableConfig) -> dict:
    _ = config
    working = state.get("working") or {}
    low = (working.get("marketplace.low_risk_properties") or {}).get("ranked") or []
    top = (working.get("marketplace.top_yielding_properties") or {}).get("ranked") or []
    port = working.get("investor.portfolio") or {}
    holdings = port.get("holdings") or []
    held_ids = {int(h["property_id"]) for h in holdings if h.get("property_id") is not None}
    low_n: list[dict[str, Any]] = []
    for r in low:
        sp = Decimal(str(r.get("sold_percentage") or 0))
        sold_ratio = sp / Decimal(100) if sp > 1 else sp
        low_n.append(
            {
                "property_id": int(r.get("property_id") or 0),
                "name": r.get("name"),
                "sold_ratio": sold_ratio,
                "risk_score": sp,
            }
        )
    top_n: list[dict[str, Any]] = []
    for r in top:
        top_n.append(
            {
                "property_id": int(r.get("property_id") or 0),
                "name": r.get("name"),
                "yield_proxy": Decimal(str(r.get("yield_proxy_ratio") or 0)),
            }
        )
    ranked = rank_investment_opportunities(
        low_risk_rows=low_n,
        top_yield_rows=top_n,
        portfolio_property_ids=held_ids,
        limit=8,
    )
    return {
        "ranked_recommendations": ranked,
        "stream_progress": _progress(state, "Ranked marketplace opportunities with explainable scores."),
        "execution_trace": _trace(
            state,
            {"step_type": "rank", "ok": True, "error": None, "duration_ms": 0, "tool_name": None},
        ),
    }


async def node_roi_compare(state: InvestorCopilotState, *, config: RunnableConfig) -> dict:
    db = config.get("configurable", {}).get("orchestration_db")
    ranked = state.get("ranked_recommendations") or []
    if not ranked:
        return {
            "stream_progress": _progress(state, "Skipping ROI compare — no ranked candidates."),
        }
    ids = [int(r["property_id"]) for r in ranked[:6] if r.get("property_id")]
    if not ids:
        return {}
    ctx = _ctx(state)
    reg = get_tool_registry()
    t0 = time.perf_counter()
    out = await reg.invoke("yield.compare_properties_by_roi", ctx, {"property_ids": ids}, db=db)
    ms = int((time.perf_counter() - t0) * 1000)
    tr = list(state.get("tool_results") or [])
    tr.append({"tool": "yield.compare_properties_by_roi", "ok": out.ok, "data": out.data, "error": out.error})
    trace = _trace(
        state,
        {
            "step_type": "tool_invoke",
            "tool_name": "yield.compare_properties_by_roi",
            "ok": out.ok,
            "error": out.error,
            "duration_ms": ms,
            "detail": {"phase": "roi_compare"},
        },
    )
    working = dict(state.get("working") or {})
    if out.ok:
        working["yield.compare_properties_by_roi"] = out.data
    return {
        "working": working,
        "tool_results": tr,
        "execution_trace": trace,
        "stream_progress": _progress(state, "Compared ROI heuristics for top candidates…"),
    }


def _resolve_invest_property_id(slots: dict[str, Any], ranked: list[dict[str, Any]]) -> int | None:
    pid = slots.get("property_id")
    if isinstance(pid, int) and pid > 0:
        return pid
    if isinstance(pid, str) and pid.isdigit():
        return int(pid)
    hint = slots.get("property_name_hint")
    if isinstance(hint, str) and hint.strip():
        h = hint.strip().lower()
        for r in ranked:
            name = str(r.get("name") or "").lower()
            if not name:
                continue
            try:
                pid_v = int(r.get("property_id") or 0)
            except (TypeError, ValueError):
                continue
            if pid_v <= 0:
                continue
            if h in name or name in h:
                return pid_v
    if ranked:
        try:
            return int(ranked[0]["property_id"])
        except (TypeError, ValueError, KeyError):
            return None
    return None


async def node_prepare_transactions(state: InvestorCopilotState, *, config: RunnableConfig) -> dict:
    db = config.get("configurable", {}).get("orchestration_db")
    intent = str(state.get("intent") or "")
    slots = dict(state.get("intent_slots") or {})
    msg = str(state.get("user_message") or "")
    warnings: list[str] = []
    prepared: list[PreparedTransaction] = []
    if intent != "invest_prepare":
        return {
            "stream_progress": _progress(state, "Skipping transaction preparation (no invest intent)."),
        }
    ranked = list(state.get("ranked_recommendations") or [])
    pid = _resolve_invest_property_id(slots, ranked)
    tok = parse_token_amount(msg)
    if tok is None and slots.get("token_amount_str"):
        try:
            d = Decimal(str(slots["token_amount_str"]))
            tok = d if d > 0 else None
        except Exception:
            tok = None
    if tok is None:
        warnings.append(
            "Investment preparation requires a token quantity (e.g. \"10 tokens\"). "
            "ETH-denominated sizing is not auto-converted here to avoid mis-sizing primary-market orders."
        )
    if pid is None:
        warnings.append("No property target resolved — specify a property id, name, or ask for ranked opportunities first.")
        return {
            "stream_progress": _progress(state, "No transaction payload prepared (missing inputs)."),
            "pending_copilot_warnings": warnings,
        }
    if tok is None:
        return {
            "stream_progress": _progress(state, "Intent recognized but tx preparation skipped (missing token amount)."),
            "pending_copilot_warnings": warnings,
        }
    ctx = _ctx(state)
    reg = get_tool_registry()
    t0 = time.perf_counter()
    out = await reg.invoke(
        "tx.prepare_investment",
        ctx,
        {"property_id": int(pid), "token_amount": str(tok)},
        db=db,
    )
    ms = int((time.perf_counter() - t0) * 1000)
    tr = list(state.get("tool_results") or [])
    tr.append({"tool": "tx.prepare_investment", "ok": out.ok, "data": out.data, "error": out.error})
    trace = _trace(
        state,
        {
            "step_type": "tool_invoke",
            "tool_name": "tx.prepare_investment",
            "ok": out.ok,
            "error": out.error,
            "duration_ms": ms,
            "detail": {"phase": "tx_prepare"},
        },
    )
    prepared.append(PreparedTransaction(tool="tx.prepare_investment", ok=out.ok, error=out.error, data=dict(out.data or {})))
    return {
        "tool_results": tr,
        "execution_trace": trace,
        "prepared_transactions": [p.model_dump(mode="json") for p in prepared],
        "stream_progress": _progress(state, "Prepared primary-market investment payload (MetaMask signing required)."),
    }


async def node_synthesize(state: InvestorCopilotState, *, config: RunnableConfig) -> dict:
    t_synth = time.perf_counter()
    intent = str(state.get("intent") or "operations_overview")
    prompt_context = state.get("prompt_context") or {}
    working = state.get("working") or {}
    slots = dict(state.get("intent_slots") or {})
    msg, reasoning = build_property_owner_narrative(
        intent=intent,
        prompt_context=prompt_context,
        working=working,
    )
    memory_tail = config.get("configurable", {}).get("copilot_memory_tail") or []
    _ = build_property_owner_copilot_system_prompt(
        prompt_context=prompt_context, intent=intent, memory_tail=memory_tail
    )

    ranked = list(state.get("ranked_recommendations") or [])
    facts_bundle: dict[str, Any] = {
        "intent": intent,
        "intent_slots": slots,
        "ranked_recommendations": ranked[:8],
        "operational_metrics": working.get("owner.get_property_operational_metrics"),
        "occupancy_trends": working.get("owner.analyze_occupancy_trends"),
        "revenue_forecast": working.get("owner.forecast_property_revenue"),
        "underperforming": working.get("owner.detect_underperforming_properties"),
        "investor_distribution": working.get("owner.analyze_investor_distribution"),
        "pricing": working.get("owner.suggest_pricing_improvements"),
        "tool_results_tail": (state.get("tool_results") or [])[-16:],
    }
    llm_msg, llm_reason, llm_warnings, llm_traces = await hybrid_enhance_copilot_narrative(
        role="property_owner",
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
            action_id="open_owner_analytics",
            title="Open owner analytics dashboard",
            rationale="Review deeper trends and KPI breakdowns in the analytics view.",
            requires_wallet=False,
        ),
        RecommendedAction(
            action_id="review_rent_configuration",
            title="Review rent configuration",
            rationale="Validate pricing and rent settings for flagged operational properties.",
            requires_wallet=True,
        ),
    ]
    if intent == "invest_prepare":
        actions.append(
            RecommendedAction(
                action_id="sign_with_metamask",
                title="Sign prepared investment in MetaMask",
                rationale="The backend never signs; approve the transaction in your wallet when ready.",
                requires_wallet=True,
            )
        )
    if ranked:
        top = ranked[0]
        actions.append(
            RecommendedAction(
                action_id="review_top_property",
                title=f"Review property {top.get('property_id')}",
                rationale=str(top.get("why", ""))[:500],
                requires_wallet=True,
            )
        )
    citations = [
        CopilotCitation(source="prompt_context:property_owner", detail="Role-scoped operational context"),
        CopilotCitation(source="tool:owner.get_property_operational_metrics", detail="Operational metrics baseline"),
    ]
    if working.get("owner.forecast_property_revenue"):
        citations.append(CopilotCitation(source="tool:owner.forecast_property_revenue", detail="Revenue projection"))
    if working.get("owner.detect_underperforming_properties"):
        citations.append(
            CopilotCitation(source="tool:owner.detect_underperforming_properties", detail="Underperformance detection")
        )
    if working.get("marketplace.low_risk_properties"):
        citations.append(CopilotCitation(source="tool:marketplace.low_risk_properties", detail="Low-risk marketplace cohort"))
    if working.get("marketplace.top_yielding_properties"):
        citations.append(CopilotCitation(source="tool:marketplace.top_yielding_properties", detail="Yield-proxy marketplace cohort"))
    citations.append(
        CopilotCitation(
            source="cognition:hybrid_llm",
            detail="Governed frontier narrative over deterministic operational analytics.",
        )
    )

    warnings = list(state.get("pending_copilot_warnings") or [])
    warnings.extend(llm_warnings)

    imode = str(slots.get("interaction_mode") or "advisory")
    if imode not in ("advisory", "execution"):
        imode = "advisory"

    prepared_raw = state.get("prepared_transactions")
    prep_models: list[PreparedTransaction] = []
    if isinstance(prepared_raw, list):
        for p in prepared_raw:
            if isinstance(p, dict):
                prep_models.append(PreparedTransaction(**p))

    prog_tail = list(state.get("stream_progress") or [])
    prog_tail.extend(
        ["Hybrid cognition: operational narrative refinement…", "Synthesized property-owner structured response."]
    )
    prep_ok = any(p.ok for p in prep_models)
    prompt_mm = imode == "execution" and prep_ok
    if prompt_mm:
        prog_tail.append("Execution-first: prepared transaction ready — wallet signature requested.")

    structured = InvestorCopilotStructuredResponse(
        message=msg,
        reasoning_summary=reasoning,
        recommended_actions=actions,
        tool_results=list(state.get("tool_results") or []),
        analytics_summary={
            "intent": intent,
            "intent_slots": slots,
            "operational_metrics_count": len((working.get("owner.get_property_operational_metrics") or {}).get("properties") or []),
            "underperforming_count": len((working.get("owner.detect_underperforming_properties") or {}).get("underperforming") or []),
            "revenue_forecast": working.get("owner.forecast_property_revenue"),
            "ranked_top": ranked[:3],
        },
        prepared_transactions=prep_models,
        warnings=warnings,
        citations=citations,
        intent=intent,
        stream_progress=prog_tail,
        interaction_mode=imode,
        prompt_metamask=prompt_mm,
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


_property_owner_copilot_compiled = None


def build_property_owner_copilot_graph():
    global _property_owner_copilot_compiled
    if _property_owner_copilot_compiled is None:
        b = StateGraph(InvestorCopilotState)
        b.add_node("load_context", node_load_context)
        b.add_node("classify_intent", node_classify_intent)
        b.add_node("gather_analytics", node_gather_analytics)
        b.add_node("rank", node_rank)
        b.add_node("roi_compare", node_roi_compare)
        b.add_node("prepare_tx", node_prepare_transactions)
        b.add_node("synthesize", node_synthesize)
        b.add_edge(START, "load_context")
        b.add_edge("load_context", "classify_intent")
        b.add_edge("classify_intent", "gather_analytics")
        b.add_edge("gather_analytics", "rank")
        b.add_edge("rank", "roi_compare")
        b.add_edge("roi_compare", "prepare_tx")
        b.add_edge("prepare_tx", "synthesize")
        b.add_edge("synthesize", END)
        _property_owner_copilot_compiled = b.compile(checkpointer=PostgresCheckpointSaver())
    return _property_owner_copilot_compiled
