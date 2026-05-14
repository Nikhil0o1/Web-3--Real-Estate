"""Property-owner operational intelligence tools."""
from __future__ import annotations

from typing import Any

from backend.agents.analytics import property_owner_intel as poi
from backend.agents.context.session import OrchestrationContext
from backend.agents.tools._router_bridge import get_tool_db
from backend.agents.tools.base import ToolMetadata, ToolResult, ToolSpec

_ROLES_PO = frozenset({"property_owner"})


async def _operational_metrics(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    cur = db.cursor(dictionary=True)
    try:
        rows = poi.get_property_operational_metrics(cur)
        return ToolResult(ok=True, data={"properties": rows})
    finally:
        cur.close()


async def _occupancy_trends(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    months = int(arguments.get("months", 6))
    cur = db.cursor(dictionary=True)
    try:
        rows = poi.analyze_occupancy_trends(cur, months=months)
        return ToolResult(ok=True, data={"trends": rows, "months": months})
    finally:
        cur.close()


async def _revenue_forecast(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    months = int(arguments.get("months", 3))
    cur = db.cursor(dictionary=True)
    try:
        out = poi.forecast_property_revenue(cur, months=months)
        return ToolResult(ok=True, data=out)
    finally:
        cur.close()


async def _underperforming(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    cur = db.cursor(dictionary=True)
    try:
        ops = poi.get_property_operational_metrics(cur)
        out = poi.detect_underperforming_properties(ops)
        return ToolResult(ok=True, data={"underperforming": out})
    finally:
        cur.close()


async def _investor_distribution(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    cur = db.cursor(dictionary=True)
    try:
        rows = poi.analyze_investor_distribution(cur)
        return ToolResult(ok=True, data={"distribution": rows})
    finally:
        cur.close()


async def _pricing(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    cur = db.cursor(dictionary=True)
    try:
        ops = poi.get_property_operational_metrics(cur)
        recs = poi.suggest_pricing_improvements(ops)
        return ToolResult(ok=True, data={"recommendations": recs})
    finally:
        cur.close()


def register_property_owner_tools(registry) -> None:
    for spec in [
        ToolSpec(
            ToolMetadata(
                "owner.get_property_operational_metrics",
                "Operational metrics per property: occupancy, investor participation, collections, score.",
                allowed_roles=_ROLES_PO,
                categories=("property_owner", "operations"),
            ),
            _operational_metrics,
        ),
        ToolSpec(
            ToolMetadata(
                "owner.analyze_occupancy_trends",
                "Monthly occupancy trend analysis from tenant_rentals history.",
                allowed_roles=_ROLES_PO,
                categories=("property_owner", "operations"),
            ),
            _occupancy_trends,
        ),
        ToolSpec(
            ToolMetadata(
                "owner.forecast_property_revenue",
                "Revenue projection using recent rent-payment run-rate and horizon months.",
                allowed_roles=_ROLES_PO,
                categories=("property_owner", "forecast"),
            ),
            _revenue_forecast,
        ),
        ToolSpec(
            ToolMetadata(
                "owner.detect_underperforming_properties",
                "Detect underperforming properties using occupancy, participation, and score thresholds.",
                allowed_roles=_ROLES_PO,
                categories=("property_owner", "operations"),
            ),
            _underperforming,
        ),
        ToolSpec(
            ToolMetadata(
                "owner.analyze_investor_distribution",
                "Investor participation and concentration distribution by property.",
                allowed_roles=_ROLES_PO,
                categories=("property_owner", "investor"),
            ),
            _investor_distribution,
        ),
        ToolSpec(
            ToolMetadata(
                "owner.suggest_pricing_improvements",
                "Rule-based pricing suggestions grounded in occupancy and participation metrics.",
                allowed_roles=_ROLES_PO,
                categories=("property_owner", "pricing"),
            ),
            _pricing,
        ),
    ]:
        registry.register(spec)
