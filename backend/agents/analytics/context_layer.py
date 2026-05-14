"""Aggregated platform snapshot for prompt builders (read-only)."""
from __future__ import annotations

from typing import Any

from backend.agents.analytics import jsonable
from backend.agents.analytics import marketplace as mp
from backend.agents.analytics import portfolio_intel as pi
from backend.agents.analytics import transactions_intel as tx


def build_platform_snapshot(
    cursor,
    *,
    user_id: int,
    wallet_address: str,
    platform_role: str,
) -> dict[str, Any]:
    """Single deterministic bundle for ``build_*_context`` helpers."""
    holdings = pi.portfolio_holdings(cursor, user_id=user_id)
    activity = tx.wallet_activity_summary(cursor, wallet_address=wallet_address)
    return jsonable(
        {
            "platform_role": platform_role,
            "wallet_address": wallet_address,
            "holdings": holdings,
            "wallet_activity": activity,
            "marketplace_count": len(mp.list_marketplace_properties(cursor)),
        }
    )
