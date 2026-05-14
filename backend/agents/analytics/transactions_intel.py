"""Transaction analytics — mirrors visibility rules of ``/transactions``."""
from __future__ import annotations

from typing import Any

from backend.agents.analytics.json import jsonable
from backend.services.auth import normalize_address


def list_transactions_for_wallet(
    cursor,
    *,
    wallet_address: str,
    tx_type: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    lim = max(1, min(int(limit), 200))
    conditions = ["LOWER(COALESCE(t.wallet_address, i.investor_wallet)) = LOWER(%s)"]
    params: list[Any] = [wallet_address]
    if tx_type:
        conditions.append("t.type = %s")
        params.append(tx_type)
    query = (
        "SELECT t.id, t.tx_hash, t.type, t.amount, t.timestamp, t.property_id, "
        "t.block_number, COALESCE(t.wallet_address, i.investor_wallet) AS wallet_address, "
        "t.gas_fee, t.amount_spent, t.remaining_balance, p.name AS property_name "
        "FROM transactions t "
        "LEFT JOIN properties p ON p.id = t.property_id "
        "LEFT JOIN investments i ON LOWER(i.deposit_tx_hash) = LOWER(t.tx_hash) "
        "WHERE " + " AND ".join(conditions) + " "
        "ORDER BY t.timestamp DESC, t.id DESC LIMIT %s"
    )
    params.append(lim)
    cursor.execute(query, tuple(params))
    rows = []
    for row in cursor.fetchall() or []:
        d = dict(row)
        ts = d.get("timestamp")
        if ts:
            d["timestamp"] = ts.isoformat()
        rows.append(jsonable(d))
    return rows


def wallet_activity_summary(cursor, *, wallet_address: str) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT t.type, COUNT(*) AS cnt
        FROM transactions t
        LEFT JOIN investments i ON LOWER(i.deposit_tx_hash) = LOWER(t.tx_hash)
        WHERE LOWER(COALESCE(t.wallet_address, i.investor_wallet)) = LOWER(%s)
        GROUP BY t.type
        """,
        (wallet_address,),
    )
    by_type = {str(r["type"]): int(r["cnt"] or 0) for r in cursor.fetchall() or []}
    return {"wallet_address": normalize_address(wallet_address), "counts_by_type": by_type}


def property_transaction_metrics(cursor, *, property_id: int) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT type, COUNT(*) AS cnt
        FROM transactions
        WHERE property_id = %s
        GROUP BY type
        """,
        (property_id,),
    )
    by_type = {str(r["type"]): int(r["cnt"] or 0) for r in cursor.fetchall() or []}
    cursor.execute("SELECT COUNT(*) AS c FROM transactions WHERE property_id = %s", (property_id,))
    total = int((cursor.fetchone() or {}).get("c") or 0)
    return {"property_id": property_id, "total_count": total, "counts_by_type": by_type}
