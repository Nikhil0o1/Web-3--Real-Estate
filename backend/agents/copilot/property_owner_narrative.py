"""Deterministic property-owner narratives from orchestration analytics."""
from __future__ import annotations

from typing import Any


def build_property_owner_narrative(
    *,
    intent: str,
    prompt_context: dict[str, Any],
    working: dict[str, Any],
) -> tuple[str, str]:
    ops = (working.get("owner.get_property_operational_metrics") or {}).get("properties") or []
    under = (working.get("owner.detect_underperforming_properties") or {}).get("underperforming") or []
    forecast = working.get("owner.forecast_property_revenue") or {}
    occupancy = (working.get("owner.analyze_occupancy_trends") or {}).get("trends") or []
    investors = (working.get("owner.analyze_investor_distribution") or {}).get("distribution") or []
    pricing = (working.get("owner.suggest_pricing_improvements") or {}).get("recommendations") or []

    parts: list[str] = []
    if ops:
        parts.append(f"Operational metrics loaded for {len(ops)} properties.")
    if occupancy:
        declining = [r for r in occupancy if (r or {}).get("trend") == "declining"]
        if declining:
            parts.append(f"{len(declining)} properties show declining occupancy trend.")
    if under:
        top = under[0]
        parts.append(
            f"Underperforming property signal: #{top.get('property_id')} {top.get('name') or ''} ({', '.join(top.get('signals') or [])})."
        )
    if forecast:
        parts.append(
            f"Projected revenue ({forecast.get('horizon_months', '?')} months): {forecast.get('total_projected_revenue_eth', '0')} ETH."
        )
    if investors:
        best = max(investors, key=lambda r: int(r.get("investor_count") or 0))
        parts.append(
            f"Strongest investor participation: property #{best.get('property_id')} with {best.get('investor_count')} investors."
        )
    if pricing:
        first = pricing[0]
        parts.append(
            f"Pricing signal for property #{first.get('property_id')}: {first.get('recommended_action')}."
        )
    if not parts:
        parts.append("No operational deltas available from current analytics pull.")
    reasoning = " ".join(parts)

    if intent == "invest_prepare":
        msg = "Primary-market investment: ranked marketplace context plus a prepared investment payload for MetaMask (you approve on-chain)."
    elif intent == "underperforming_detection":
        msg = "Here are underperforming-property signals grounded in occupancy, participation, and collected-rent metrics."
    elif intent == "revenue_forecast":
        msg = "Here is your deterministic revenue forecast derived from recent rent-payment run-rate and configured rent levels."
    elif intent == "pricing_optimization":
        msg = "Here are pricing-optimization suggestions based on occupancy and participation behavior."
    elif intent == "investor_participation":
        msg = "Here is investor participation intelligence across your property portfolio."
    elif intent == "occupancy_analysis":
        msg = "Here is your occupancy trend analysis from rental activity signals."
    else:
        msg = "Here is your property-operations intelligence summary from the orchestration analytics bundle."
    return msg, reasoning
