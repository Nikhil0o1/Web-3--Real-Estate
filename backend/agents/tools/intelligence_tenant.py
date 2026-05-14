"""Tenant-facing intelligence tools."""
from __future__ import annotations

from typing import Any

from backend.agents.analytics import tenant_intel as ti
from backend.agents.context.session import OrchestrationContext
from backend.agents.tools._router_bridge import auth_user_from_orchestration, get_tool_db, sync_route_tool
from backend.agents.tools.base import ToolMetadata, ToolResult, ToolSpec
from backend.api.routers.rent import tenant_active_rentals, tenant_list_properties, tenant_payment_history


async def _tenant_props(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    return sync_route_tool("tenant.list_properties", tenant_list_properties, db=db)


async def _tenant_payments(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    user = auth_user_from_orchestration(ctx)
    return sync_route_tool(
        "tenant.payment_history",
        tenant_payment_history,
        wallet_address=ctx.wallet_address,
        db=db,
        user=user,
    )


async def _tenant_rentals(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    user = auth_user_from_orchestration(ctx)
    return sync_route_tool(
        "tenant.active_rentals",
        tenant_active_rentals,
        wallet_address=ctx.wallet_address,
        db=db,
        user=user,
    )


async def _payment_summary(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    cur = db.cursor(dictionary=True)
    try:
        out = ti.get_tenant_payment_summary(cur, wallet_address=ctx.wallet_address)
        return ToolResult(ok=True, data=out)
    finally:
        cur.close()


async def _rent_forecast(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    months = int(arguments.get("months", 3))
    cur = db.cursor(dictionary=True)
    try:
        out = ti.forecast_rent_obligations(cur, wallet_address=ctx.wallet_address, months=months)
        return ToolResult(ok=True, data=out)
    finally:
        cur.close()


async def _behavior(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    months = int(arguments.get("months", 6))
    cur = db.cursor(dictionary=True)
    try:
        out = ti.analyze_payment_behavior(cur, wallet_address=ctx.wallet_address, months=months)
        return ToolResult(ok=True, data=out)
    finally:
        cur.close()


async def _affordability(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    cur = db.cursor(dictionary=True)
    try:
        out = ti.calculate_affordability_metrics(cur, wallet_address=ctx.wallet_address)
        return ToolResult(ok=True, data=out)
    finally:
        cur.close()


async def _reminder(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    cur = db.cursor(dictionary=True)
    try:
        out = ti.get_next_payment_reminder(cur, wallet_address=ctx.wallet_address)
        return ToolResult(ok=True, data=out)
    finally:
        cur.close()


def register_tenant_tools(registry) -> None:
    for spec in [
        ToolSpec(
            ToolMetadata(
                "tenant.list_properties",
                "Same payload as GET /tenant/properties (rent flags + enrichment).",
                allowed_roles=frozenset({"tenant", "property_owner"}),
                categories=("tenant", "marketplace"),
            ),
            _tenant_props,
        ),
        ToolSpec(
            ToolMetadata(
                "tenant.payment_history",
                "Wallet-scoped tenant payment history.",
                allowed_roles=frozenset({"tenant"}),
                categories=("tenant", "payments"),
            ),
            _tenant_payments,
        ),
        ToolSpec(
            ToolMetadata(
                "tenant.active_rentals",
                "Wallet-scoped active rentals.",
                allowed_roles=frozenset({"tenant"}),
                categories=("tenant", "rentals"),
            ),
            _tenant_rentals,
        ),
        ToolSpec(
            ToolMetadata(
                "tenant.get_tenant_payment_summary",
                "Aggregated payment totals, counts, and last payment date for the tenant.",
                allowed_roles=frozenset({"tenant"}),
                categories=("tenant", "payments"),
            ),
            _payment_summary,
        ),
        ToolSpec(
            ToolMetadata(
                "tenant.forecast_rent_obligations",
                "Forecast rental obligations from active rentals over a configurable horizon.",
                allowed_roles=frozenset({"tenant"}),
                categories=("tenant", "forecast"),
            ),
            _rent_forecast,
        ),
        ToolSpec(
            ToolMetadata(
                "tenant.analyze_payment_behavior",
                "Monthly payment consistency and behavior summary.",
                allowed_roles=frozenset({"tenant"}),
                categories=("tenant", "payments"),
            ),
            _behavior,
        ),
        ToolSpec(
            ToolMetadata(
                "tenant.calculate_affordability_metrics",
                "Affordability estimates from wallet balance and monthly obligations.",
                allowed_roles=frozenset({"tenant"}),
                categories=("tenant", "affordability"),
            ),
            _affordability,
        ),
        ToolSpec(
            ToolMetadata(
                "tenant.next_payment_reminder",
                "Upcoming rent reminder using active-rental obligations.",
                allowed_roles=frozenset({"tenant"}),
                categories=("tenant", "reminder"),
            ),
            _reminder,
        ),
    ]:
        registry.register(spec)
