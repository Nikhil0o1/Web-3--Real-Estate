"""Investor portfolio analytics — DB + optional on-chain sync via existing helpers."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from backend.agents.analytics.json import jsonable


def portfolio_holdings(cursor, *, user_id: int) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT t.property_id, p.name AS property_name, t.token_amount
        FROM token_ownerships t
        JOIN properties p ON p.id = t.property_id
        WHERE t.user_id = %s AND t.token_amount > 0
        """,
        (user_id,),
    )
    return [jsonable(dict(r)) for r in cursor.fetchall() or []]


def investment_history(cursor, *, wallet_address: str, limit: int = 50) -> list[dict[str, Any]]:
    lim = max(1, min(int(limit), 200))
    cursor.execute(
        """
        SELECT id, property_id, token_amount_base, eth_amount_wei, status, deposit_tx_hash, created_at
        FROM investments
        WHERE LOWER(investor_wallet) = LOWER(%s)
        ORDER BY created_at DESC, id DESC
        LIMIT %s
        """,
        (wallet_address, lim),
    )
    rows = []
    for r in cursor.fetchall() or []:
        d = dict(r)
        if d.get("created_at"):
            d["created_at"] = d["created_at"].isoformat()
        rows.append(jsonable(d))
    return rows


def diversification_analysis(holdings: list[dict[str, Any]]) -> dict[str, Any]:
    if not holdings:
        return {
            "property_count": 0,
            "herfindahl_index": "0",
            "largest_position_weight": "0",
        }
    amounts = [Decimal(str(h.get("token_amount") or 0)) for h in holdings]
    total = sum(amounts)
    if total <= 0:
        return {"property_count": len(holdings), "herfindahl_index": "0", "largest_position_weight": "0"}
    shares = [a / total for a in amounts]
    hhi = sum(s * s for s in shares)
    largest = max(shares)
    return {
        "property_count": len(holdings),
        "herfindahl_index": str(hhi),
        "largest_position_weight": str(largest),
    }


def passive_income_metrics_from_rewards(
    *,
    total_claimable_wei: int,
    total_claimed_wei: int,
) -> dict[str, Any]:
    return {
        "total_claimable_wei": str(total_claimable_wei),
        "total_claimed_wei": str(total_claimed_wei),
        "note": "Rent rewards are modeled from indexed payout rows + on-chain claimable reads in reward tools.",
    }
