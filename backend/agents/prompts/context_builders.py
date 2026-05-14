"""Role-scoped context bundles for future LLM system prompts (Phase 3)."""
from __future__ import annotations

from typing import Any

from backend.agents.analytics.context_layer import build_platform_snapshot
from backend.agents.analytics import portfolio_intel as pi
from backend.agents.analytics import property_owner_intel as poi
from backend.agents.analytics import tenant_intel as ti
from backend.agents.analytics import yield_roi as yr
from backend.agents.schemas.finance import (
    DiversificationAnalysis,
    PortfolioSummary,
    PropertyYieldAnalysis,
)


def build_investor_context(cursor, *, user_id: int, wallet_address: str, platform_role: str) -> dict[str, Any]:
    snap = build_platform_snapshot(
        cursor, user_id=user_id, wallet_address=wallet_address, platform_role=platform_role
    )
    holdings = pi.portfolio_holdings(cursor, user_id=user_id)
    div = pi.diversification_analysis(holdings)
    summary = PortfolioSummary(
        wallet_address=wallet_address,
        property_count=len(holdings),
        herfindahl_index=div.get("herfindahl_index"),
    )
    analyses: list[PropertyYieldAnalysis] = []
    for h in holdings[:5]:
        roi = yr.analyze_property_roi(cursor, property_id=int(h["property_id"]))
        if roi:
            analyses.append(
                PropertyYieldAnalysis(
                    property_id=int(roi["property_id"]),
                    monthly_rent_eth=roi.get("monthly_rent_eth"),
                    annual_rent_to_book_value=roi.get("annual_rent_to_book_value"),
                    sold_ratio=roi.get("sold_ratio"),
                )
            )
    return {
        "role": "investor",
        "snapshot": snap,
        "portfolio_summary": summary.model_dump(mode="json"),
        "diversification": DiversificationAnalysis(
            property_count=int(div["property_count"]),
            herfindahl_index=str(div["herfindahl_index"]),
            largest_position_weight=str(div["largest_position_weight"]),
        ).model_dump(mode="json"),
        "top_property_yield_views": [a.model_dump(mode="json") for a in analyses],
    }


def build_property_owner_context(cursor, *, user_id: int, wallet_address: str, platform_role: str) -> dict[str, Any]:
    snap = build_platform_snapshot(
        cursor, user_id=user_id, wallet_address=wallet_address, platform_role=platform_role
    )
    ops = poi.get_property_operational_metrics(cursor)
    under = poi.detect_underperforming_properties(ops)
    revenue = poi.forecast_property_revenue(cursor, months=3)
    investors = poi.analyze_investor_distribution(cursor)
    occupancy = poi.analyze_occupancy_trends(cursor, months=6)
    return {
        "role": "property_owner",
        "snapshot": snap,
        "operational_metrics": ops[:15],
        "underperforming": under[:10],
        "revenue_forecast": revenue,
        "investor_distribution": investors[:15],
        "occupancy_trends": occupancy[:15],
        "note": "Use owner.* tools for operational intelligence and pricing/risk workflows.",
    }


def build_tenant_context(cursor, *, user_id: int, wallet_address: str, platform_role: str) -> dict[str, Any]:
    snap = build_platform_snapshot(
        cursor, user_id=user_id, wallet_address=wallet_address, platform_role=platform_role
    )
    payment_summary = ti.get_tenant_payment_summary(cursor, wallet_address=wallet_address)
    rent_forecast = ti.forecast_rent_obligations(cursor, wallet_address=wallet_address, months=3)
    behavior = ti.analyze_payment_behavior(cursor, wallet_address=wallet_address, months=6)
    affordability = ti.calculate_affordability_metrics(cursor, wallet_address=wallet_address)
    reminder = ti.get_next_payment_reminder(cursor, wallet_address=wallet_address)
    return {
        "role": "tenant",
        "snapshot": snap,
        "payment_summary": payment_summary,
        "rent_forecast": rent_forecast,
        "payment_behavior": behavior,
        "affordability": affordability,
        "next_payment": reminder,
        "note": "Use tenant.* tools for reminders, affordability, and rental-payment assistance.",
    }


def build_prompt_context_for_role(
    cursor,
    *,
    user_id: int,
    wallet_address: str,
    platform_role: str,
) -> dict[str, Any]:
    role = platform_role.lower()
    if role == "investor":
        return build_investor_context(cursor, user_id=user_id, wallet_address=wallet_address, platform_role=role)
    if role == "property_owner":
        return build_property_owner_context(cursor, user_id=user_id, wallet_address=wallet_address, platform_role=role)
    if role == "tenant":
        return build_tenant_context(cursor, user_id=user_id, wallet_address=wallet_address, platform_role=role)
    return {"role": role, "snapshot": {}, "note": "Unknown role — minimal context."}
