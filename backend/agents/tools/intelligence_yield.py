"""Yield / ROI analytics tools."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from backend.agents.analytics import yield_roi as yr
from backend.agents.context.session import OrchestrationContext
from backend.agents.tools._router_bridge import get_tool_db
from backend.agents.tools.base import ToolMetadata, ToolResult, ToolSpec

_ROLES_INV_PO = frozenset({"investor", "property_owner"})


async def _property_roi(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    pid = int(arguments.get("property_id", 0))
    if pid <= 0:
        return ToolResult(ok=False, error="INVALID_PROPERTY_ID")
    cur = db.cursor(dictionary=True)
    try:
        r = yr.analyze_property_roi(cur, property_id=pid)
        if not r:
            return ToolResult(ok=False, error="NOT_FOUND", data={"property_id": pid})
        return ToolResult(ok=True, data=r)
    finally:
        cur.close()


async def _forecast_yield(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    monthly = Decimal(str(arguments.get("monthly_rent_eth", "0")))
    basis = Decimal(str(arguments.get("basis_eth", "0")))
    r = yr.forecast_rental_yield(monthly_rent_eth=monthly, basis_eth=basis)
    return ToolResult(ok=True, data=r)


async def _expected_income(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    tok = Decimal(str(arguments.get("token_amount", "0")))
    rent = Decimal(str(arguments.get("monthly_rent_eth", "0")))
    supply = Decimal(str(arguments.get("token_supply", "0")))
    r = yr.expected_passive_income_from_holdings(
        token_amount=tok, monthly_rent_eth=rent, token_supply=supply
    )
    return ToolResult(ok=True, data=r)


async def _compare_roi(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    ids = arguments.get("property_ids") or []
    if not isinstance(ids, list):
        return ToolResult(ok=False, error="property_ids_must_be_array")

    def _pid(v: Any) -> int | None:
        try:
            i = int(v)
            return i if i > 0 else None
        except (TypeError, ValueError):
            return None

    pids = [x for x in (_pid(v) for v in ids) if x is not None][:20]
    cur = db.cursor(dictionary=True)
    try:
        rows = yr.compare_properties_by_roi(cur, pids)
        return ToolResult(ok=True, data={"properties": rows})
    finally:
        cur.close()


def register_yield_tools(registry) -> None:
    for spec in [
        ToolSpec(
            ToolMetadata(
                "yield.analyze_property_roi",
                "Deterministic ROI-style heuristics from DB listing fields.",
                allowed_roles=_ROLES_INV_PO,
                categories=("yield", "analytics"),
            ),
            _property_roi,
        ),
        ToolSpec(
            ToolMetadata(
                "yield.forecast_rental_yield",
                "Annual yield from explicit monthly rent + capital basis (no hidden assumptions).",
                allowed_roles=_ROLES_INV_PO,
                categories=("yield",),
            ),
            _forecast_yield,
        ),
        ToolSpec(
            ToolMetadata(
                "yield.expected_passive_income",
                "Expected monthly/annual rent share from explicit token counts and rent.",
                allowed_roles=_ROLES_INV_PO,
                categories=("yield", "investor"),
            ),
            _expected_income,
        ),
        ToolSpec(
            ToolMetadata(
                "yield.compare_properties_by_roi",
                "Batch ROI heuristics for up to 20 property ids.",
                allowed_roles=_ROLES_INV_PO,
                categories=("yield", "marketplace"),
            ),
            _compare_roi,
        ),
    ]:
        registry.register(spec)
