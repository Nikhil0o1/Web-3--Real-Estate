"""Marketplace + property intelligence tools."""
from __future__ import annotations

from typing import Any

from backend.agents.analytics import marketplace as mp
from backend.agents.context.session import OrchestrationContext
from backend.agents.observability.logging import get_agent_logger, log_orchestration_event
from backend.agents.tools._router_bridge import get_tool_db
from backend.agents.tools.base import ToolMetadata, ToolResult, ToolSpec

_LOGGER = get_agent_logger("tools.marketplace")


def _require_db(ctx: OrchestrationContext) -> Any:
    return get_tool_db(ctx)


async def _list_properties(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = _require_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    cur = db.cursor(dictionary=True)
    try:
        data = mp.list_marketplace_properties(cur)
        log_orchestration_event(_LOGGER, "analytics_marketplace_list", trace_id=ctx.trace_id, extra={"count": len(data)})
        return ToolResult(ok=True, data={"properties": data})
    finally:
        cur.close()


async def _get_property(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = _require_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    pid = int(arguments.get("property_id", 0))
    if pid <= 0:
        return ToolResult(ok=False, error="INVALID_PROPERTY_ID")
    cur = db.cursor(dictionary=True)
    try:
        row = mp.get_property_row(cur, pid)
        if not row:
            return ToolResult(ok=False, error="NOT_FOUND", data={"property_id": pid})
        return ToolResult(ok=True, data={"property": row})
    finally:
        cur.close()


async def _property_metrics(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = _require_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    pid = int(arguments.get("property_id", 0))
    if pid <= 0:
        return ToolResult(ok=False, error="INVALID_PROPERTY_ID")
    cur = db.cursor(dictionary=True)
    try:
        m = mp.property_metrics(cur, pid)
        if not m:
            return ToolResult(ok=False, error="NOT_FOUND", data={"property_id": pid})
        return ToolResult(ok=True, data=m)
    finally:
        cur.close()


async def _top_yield(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = _require_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    limit = int(arguments.get("limit", 10))
    cur = db.cursor(dictionary=True)
    try:
        rows = mp.top_yielding_properties(cur, limit=limit)
        return ToolResult(ok=True, data={"ranked": rows})
    finally:
        cur.close()


async def _low_risk(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = _require_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    limit = int(arguments.get("limit", 10))
    cur = db.cursor(dictionary=True)
    try:
        rows = mp.low_risk_properties(cur, limit=limit)
        return ToolResult(ok=True, data={"ranked": rows})
    finally:
        cur.close()


async def _occupancy(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = _require_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    pid = int(arguments.get("property_id", 0))
    if pid <= 0:
        return ToolResult(ok=False, error="INVALID_PROPERTY_ID")
    cur = db.cursor(dictionary=True)
    try:
        m = mp.property_occupancy_metrics(cur, pid)
        if not m:
            return ToolResult(ok=False, error="NOT_FOUND", data={"property_id": pid})
        return ToolResult(ok=True, data=m)
    finally:
        cur.close()


async def _rental_history(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = _require_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    pid = int(arguments.get("property_id", 0))
    limit = int(arguments.get("limit", 50))
    if pid <= 0:
        return ToolResult(ok=False, error="INVALID_PROPERTY_ID")
    cur = db.cursor(dictionary=True)
    try:
        rows = mp.property_rental_history(cur, pid, limit=limit)
        return ToolResult(ok=True, data={"payments": rows})
    finally:
        cur.close()


_ROLES_INV_PO = frozenset({"investor", "property_owner"})
_ROLES_PO = frozenset({"property_owner"})


def register_marketplace_tools(registry) -> None:
    specs = [
        ToolSpec(
            ToolMetadata(
                "marketplace.list_properties",
                "List all properties with the same enrichment as the public catalog API.",
                allowed_roles=None,
                categories=("marketplace",),
            ),
            _list_properties,
        ),
        ToolSpec(
            ToolMetadata(
                "marketplace.get_property",
                "Fetch a single property by id (enriched).",
                allowed_roles=None,
                categories=("marketplace",),
            ),
            _get_property,
        ),
        ToolSpec(
            ToolMetadata(
                "marketplace.property_metrics",
                "Structured sale/rent/absorption metrics for one property.",
                allowed_roles=None,
                categories=("marketplace",),
            ),
            _property_metrics,
        ),
        ToolSpec(
            ToolMetadata(
                "marketplace.top_yielding_properties",
                "Rank properties by rent_wei / list_price_wei proxy.",
                allowed_roles=_ROLES_INV_PO,
                categories=("marketplace", "yield"),
            ),
            _top_yield,
        ),
        ToolSpec(
            ToolMetadata(
                "marketplace.low_risk_properties",
                "Heuristic ranking favoring higher sold% with rent configured.",
                allowed_roles=_ROLES_INV_PO,
                categories=("marketplace", "risk"),
            ),
            _low_risk,
        ),
        ToolSpec(
            ToolMetadata(
                "marketplace.property_occupancy_metrics",
                "Active vs total tenant rentals for a property.",
                allowed_roles=_ROLES_PO,
                categories=("marketplace", "operations"),
            ),
            _occupancy,
        ),
        ToolSpec(
            ToolMetadata(
                "marketplace.property_rental_history",
                "Recent rent payments for a property (property owner analytics).",
                allowed_roles=_ROLES_PO,
                categories=("marketplace", "operations"),
            ),
            _rental_history,
        ),
    ]
    for spec in specs:
        registry.register(spec)
