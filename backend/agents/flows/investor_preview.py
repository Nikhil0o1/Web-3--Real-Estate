"""Example multi-tool orchestration flows for backend validation (not UX)."""
from __future__ import annotations

from typing import Any

from backend.agents.context.session import OrchestrationContext
from backend.agents.orchestration.results import extract_last_tool_result
from backend.agents.orchestrator.service import get_orchestration_service


def _step(tool: str, result) -> dict[str, Any]:
    return {
        "tool": tool,
        "ok": result.ok,
        "error": result.error,
        "data": result.data if result.ok else None,
    }


async def run_investor_intel_preview(db, ctx: OrchestrationContext) -> dict[str, Any]:
    svc = get_orchestration_service()
    steps: list[dict[str, Any]] = []
    portfolio = extract_last_tool_result(
        await svc.execute_tool_via_graph(ctx, db, "investor.portfolio", {"refresh": False}),
    )
    steps.append(_step("investor.portfolio", portfolio))
    holdings = (portfolio.data or {}).get("holdings") or [] if portfolio.ok else []
    if holdings:
        pid = int(holdings[0]["property_id"])
        roi = extract_last_tool_result(
            await svc.execute_tool_via_graph(ctx, db, "yield.analyze_property_roi", {"property_id": pid}),
        )
        steps.append(_step("yield.analyze_property_roi", roi))
    recent = extract_last_tool_result(
        await svc.execute_tool_via_graph(ctx, db, "transactions.recent", {"limit": 8}),
    )
    steps.append(_step("transactions.recent", recent))
    return {"trace_id": ctx.trace_id, "flow": "investor_intel_preview_v1", "steps": steps}


async def run_roi_analysis_flow(db, ctx: OrchestrationContext, property_ids: list[int]) -> dict[str, Any]:
    svc = get_orchestration_service()
    cmp_res = extract_last_tool_result(
        await svc.execute_tool_via_graph(
            ctx,
            db,
            "yield.compare_properties_by_roi",
            {"property_ids": property_ids},
        ),
    )
    return {"trace_id": ctx.trace_id, "flow": "roi_analysis_v1", "compare": _step("yield.compare_properties_by_roi", cmp_res)}


async def run_tx_prep_probe_flow(db, ctx: OrchestrationContext) -> dict[str, Any]:
    """Only validates routing; does not assume claimable balance or tenant rent state."""
    svc = get_orchestration_service()
    ping = extract_last_tool_result(await svc.execute_tool_via_graph(ctx, db, "orchestration.ping", {}))
    return {"trace_id": ctx.trace_id, "flow": "tx_prep_probe_v1", "steps": [_step("orchestration.ping", ping)]}
