"""Transaction analytics tools (visibility aligned with /transactions)."""
from __future__ import annotations

from typing import Any

from backend.agents.analytics import transactions_intel as tx
from backend.agents.context.session import OrchestrationContext
from backend.agents.tools._router_bridge import get_tool_db
from backend.agents.tools.base import ToolMetadata, ToolResult, ToolSpec
from backend.services.auth import normalize_address

_ROLES_ALL = frozenset({"investor", "property_owner", "tenant"})


def _effective_wallet(arguments: dict[str, Any], ctx: OrchestrationContext) -> str:
    requested = arguments.get("wallet_address")
    if ctx.platform_role == "property_owner" and requested:
        return str(requested)
    return ctx.wallet_address


async def _tx_list(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    wallet = normalize_address(_effective_wallet(arguments, ctx))
    if ctx.platform_role != "property_owner" and normalize_address(wallet) != normalize_address(ctx.wallet_address):
        return ToolResult(ok=False, error="WALLET_SCOPE_FORBIDDEN")
    tx_type = arguments.get("tx_type")
    limit = int(arguments.get("limit", 50))
    cur = db.cursor(dictionary=True)
    try:
        rows = tx.list_transactions_for_wallet(cur, wallet_address=wallet, tx_type=tx_type, limit=limit)
        return ToolResult(ok=True, data={"transactions": rows, "wallet_address": wallet})
    finally:
        cur.close()


async def _tx_recent(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    arguments = {**arguments, "limit": int(arguments.get("limit", 20))}
    return await _tx_list(ctx, arguments)


async def _wallet_summary(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    wallet = normalize_address(_effective_wallet(arguments, ctx))
    if ctx.platform_role != "property_owner" and normalize_address(wallet) != normalize_address(ctx.wallet_address):
        return ToolResult(ok=False, error="WALLET_SCOPE_FORBIDDEN")
    cur = db.cursor(dictionary=True)
    try:
        summary = tx.wallet_activity_summary(cursor=cur, wallet_address=wallet)
        return ToolResult(ok=True, data=summary)
    finally:
        cur.close()


async def _prop_metrics(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    pid = int(arguments.get("property_id", 0))
    if pid <= 0:
        return ToolResult(ok=False, error="INVALID_PROPERTY_ID")
    cur = db.cursor(dictionary=True)
    try:
        m = tx.property_transaction_metrics(cur, property_id=pid)
        return ToolResult(ok=True, data=m)
    finally:
        cur.close()


def register_transaction_tools(registry) -> None:
    for spec in [
        ToolSpec(
            ToolMetadata(
                "transactions.list",
                "Indexed transaction rows for a wallet (non–property-owner: self only).",
                allowed_roles=_ROLES_ALL,
                categories=("transactions",),
            ),
            _tx_list,
        ),
        ToolSpec(
            ToolMetadata(
                "transactions.recent",
                "Shorthand for transactions.list with a smaller default limit.",
                allowed_roles=_ROLES_ALL,
                categories=("transactions",),
            ),
            _tx_recent,
        ),
        ToolSpec(
            ToolMetadata(
                "transactions.wallet_activity_summary",
                "Counts grouped by tx type for a wallet.",
                allowed_roles=_ROLES_ALL,
                categories=("transactions",),
            ),
            _wallet_summary,
        ),
        ToolSpec(
            ToolMetadata(
                "transactions.property_metrics",
                "Aggregate counts for a property_id.",
                allowed_roles=frozenset({"investor", "property_owner"}),
                categories=("transactions", "marketplace"),
            ),
            _prop_metrics,
        ),
    ]:
        registry.register(spec)
