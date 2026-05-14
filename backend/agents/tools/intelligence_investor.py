"""Investor / portfolio intelligence tools."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from backend.agents.analytics import portfolio_intel as pi
from backend.agents.context.session import OrchestrationContext
from backend.agents.observability.logging import get_agent_logger, log_orchestration_event
from backend.agents.tools._router_bridge import auth_user_from_orchestration, get_tool_db, sync_route_tool
from backend.agents.tools.base import ToolMetadata, ToolResult, ToolSpec
from backend.api.routers.investments import _sync_wallet_holdings_from_chain
from backend.api.routers.rent import reward_claimable_summary
from backend.services.auth import normalize_address

_LOGGER = get_agent_logger("tools.investor")
_ROLES_INV_PO = frozenset({"investor", "property_owner"})


async def _portfolio(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    refresh = bool(arguments.get("refresh", False))
    cur = db.cursor(dictionary=True)
    try:
        if refresh:
            synced, uid = _sync_wallet_holdings_from_chain(
                cur,
                wallet_address=normalize_address(ctx.wallet_address),
                user_id=int(ctx.user_id),
            )
            if synced:
                db.commit()
        holdings = pi.portfolio_holdings(cur, user_id=int(ctx.user_id))
        div = pi.diversification_analysis(holdings)
        log_orchestration_event(_LOGGER, "analytics_portfolio", trace_id=ctx.trace_id, extra={"holdings": len(holdings)})
        return ToolResult(ok=True, data={"holdings": holdings, "diversification": div, "refreshed": refresh})
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        return ToolResult(ok=False, error=str(exc))
    finally:
        cur.close()


async def _portfolio_performance(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    refresh = bool(arguments.get("refresh", False))
    cur = db.cursor(dictionary=True)
    try:
        if refresh:
            synced, uid = _sync_wallet_holdings_from_chain(
                cur,
                wallet_address=normalize_address(ctx.wallet_address),
                user_id=int(ctx.user_id),
            )
            if synced:
                db.commit()
        holdings = pi.portfolio_holdings(cur, user_id=int(ctx.user_id))
        total_wei = Decimal(0)
        rows = []
        for h in holdings:
            pid = int(h["property_id"])
            cur.execute(
                "SELECT token_price_base, token_symbol FROM properties WHERE id = %s",
                (pid,),
            )
            pr = cur.fetchone() or {}
            price_wei = Decimal(str(pr.get("token_price_base") or 0))
            amt = Decimal(str(h.get("token_amount") or 0))
            pos_wei = price_wei * amt
            total_wei += pos_wei
            rows.append(
                {
                    "property_id": pid,
                    "token_amount": str(amt),
                    "token_price_wei": str(price_wei),
                    "position_value_wei": str(pos_wei),
                    "token_symbol": pr.get("token_symbol"),
                }
            )
        return ToolResult(
            ok=True,
            data={
                "positions": rows,
                "aggregate_position_value_wei": str(total_wei),
                "note": "Position value uses list price per token × DB token balance (same units as on-chain sale price).",
            },
        )
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        return ToolResult(ok=False, error=str(exc))
    finally:
        cur.close()


async def _claimable(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    user = auth_user_from_orchestration(ctx)
    if ctx.platform_role not in ("investor", "property_owner"):
        return ToolResult(ok=False, error="TOOL_FORBIDDEN_FOR_ROLE")
    out = sync_route_tool(
        "investor.claimable_rewards",
        reward_claimable_summary,
        wallet_address=ctx.wallet_address,
        db=db,
        user=user,
    )
    return out


async def _inv_history(ctx: OrchestrationContext, arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    limit = int(arguments.get("limit", 50))
    cur = db.cursor(dictionary=True)
    try:
        rows = pi.investment_history(cur, wallet_address=ctx.wallet_address, limit=limit)
        return ToolResult(ok=True, data={"investments": rows})
    finally:
        cur.close()


async def _passive_income(ctx: OrchestrationContext, _arguments: dict[str, Any]) -> ToolResult:
    db = get_tool_db(ctx)
    if not db:
        return ToolResult(ok=False, error="DB_REQUIRED")
    claim = await _claimable(ctx, {})
    if not claim.ok:
        return claim
    total_claimable = int(claim.data.get("result", {}).get("total_claimable_wei", 0) or 0)
    total_claimed = int(claim.data.get("result", {}).get("total_claimed_wei", 0) or 0)
    metrics = pi.passive_income_metrics_from_rewards(
        total_claimable_wei=total_claimable,
        total_claimed_wei=total_claimed,
    )
    return ToolResult(ok=True, data={"rewards": claim.data.get("result"), "metrics": metrics})


def register_investor_tools(registry) -> None:
    for spec in [
        ToolSpec(
            ToolMetadata(
                "investor.portfolio",
                "DB token holdings + diversification; optional on-chain refresh like /portfolio.",
                allowed_roles=_ROLES_INV_PO,
                categories=("investor", "portfolio"),
            ),
            _portfolio,
        ),
        ToolSpec(
            ToolMetadata(
                "investor.portfolio_performance",
                "Aggregate position notionals from list price × holdings.",
                allowed_roles=_ROLES_INV_PO,
                categories=("investor", "portfolio"),
            ),
            _portfolio_performance,
        ),
        ToolSpec(
            ToolMetadata(
                "investor.claimable_rewards",
                "Wraps GET /rewards/claimable/{wallet} logic in-process.",
                allowed_roles=_ROLES_INV_PO,
                categories=("investor", "rewards"),
            ),
            _claimable,
        ),
        ToolSpec(
            ToolMetadata(
                "investor.investment_history",
                "Investment rows for the authenticated wallet.",
                allowed_roles=_ROLES_INV_PO,
                categories=("investor", "history"),
            ),
            _inv_history,
        ),
        ToolSpec(
            ToolMetadata(
                "investor.passive_income_metrics",
                "Combines claimable summary with passive-income scaffolding.",
                allowed_roles=_ROLES_INV_PO,
                categories=("investor", "rewards"),
            ),
            _passive_income,
        ),
    ]:
        registry.register(spec)
