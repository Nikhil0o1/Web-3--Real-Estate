"""Marketplace intelligence — DB + existing enrichment (no new sale rules)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from backend.agents.analytics.json import jsonable
from backend.api._helpers import enrich_property_with_supply, fetch_property


def list_marketplace_properties(cursor) -> list[dict[str, Any]]:
    cursor.execute("SELECT * FROM properties ORDER BY id DESC")
    rows = cursor.fetchall() or []
    return [jsonable(enrich_property_with_supply(cursor, dict(row))) for row in rows]


def get_property_row(cursor, property_id: int) -> dict[str, Any] | None:
    row = fetch_property(cursor, property_id)
    if not row:
        return None
    return jsonable(enrich_property_with_supply(cursor, dict(row)))


def property_metrics(cursor, property_id: int) -> dict[str, Any] | None:
    row = get_property_row(cursor, property_id)
    if not row:
        return None
    rent_wei = row.get("monthly_rent_wei") or "0"
    rent_enabled = rent_wei not in (None, "", "0")
    return {
        "property": row,
        "rent_enabled": rent_enabled,
        "sold_percentage": row.get("sold_percentage"),
        "tokens_available": row.get("tokens_available"),
        "tokens_sold": row.get("tokens_sold"),
    }


def top_yielding_properties(cursor, *, limit: int = 10) -> list[dict[str, Any]]:
    """Rank by monthly_rent_wei / NULLIF(token_price_base,0) — deterministic proxy, not tax advice."""
    lim = max(1, min(int(limit), 50))
    cursor.execute(
        """
        SELECT id, name,
               CAST(COALESCE(monthly_rent_wei, '0') AS DECIMAL(40,0)) AS rent_wei,
               CAST(COALESCE(token_price_base, '0') AS DECIMAL(40,0)) AS price_wei
        FROM properties
        WHERE COALESCE(monthly_rent_wei, '0') <> '0'
          AND COALESCE(token_price_base, '0') <> '0'
        ORDER BY (CAST(COALESCE(monthly_rent_wei, '0') AS DECIMAL(40,0))
                  / NULLIF(CAST(COALESCE(token_price_base, '0') AS DECIMAL(40,0)), 0)) DESC
        LIMIT %s
        """,
        (lim,),
    )
    ranked: list[dict[str, Any]] = []
    for row in cursor.fetchall() or []:
        rent = Decimal(str(row["rent_wei"] or 0))
        price = Decimal(str(row["price_wei"] or 0))
        ratio = (rent / price) if price > 0 else Decimal(0)
        ranked.append(
            {
                "property_id": int(row["id"]),
                "name": row["name"],
                "yield_proxy_ratio": str(ratio),
            }
        )
    return ranked


def low_risk_properties(cursor, *, limit: int = 10) -> list[dict[str, Any]]:
    """Heuristic: higher primary-market absorption (sold %) with rent configured."""
    lim = max(1, min(int(limit), 50))
    cursor.execute("SELECT * FROM properties ORDER BY id DESC")
    enriched: list[dict[str, Any]] = []
    for raw in cursor.fetchall() or []:
        row = enrich_property_with_supply(cursor, dict(raw))
        sp = Decimal(str(row.get("sold_percentage") or 0))
        rent_wei = row.get("monthly_rent_wei") or "0"
        if rent_wei in (None, "", "0"):
            continue
        enriched.append(
            {
                "property_id": int(row["id"]),
                "name": row["name"],
                "sold_percentage": str(sp),
                "has_rent_config": True,
            }
        )
    enriched.sort(key=lambda x: Decimal(x["sold_percentage"]), reverse=True)
    return enriched[:lim]


def property_occupancy_metrics(cursor, property_id: int) -> dict[str, Any] | None:
    if not fetch_property(cursor, property_id):
        return None
    cursor.execute(
        """
        SELECT COUNT(*) FILTER (WHERE status = 'active') AS active_leases,
               COUNT(*) AS total_leases
        FROM tenant_rentals
        WHERE property_id = %s
        """,
        (property_id,),
    )
    row = cursor.fetchone() or {}
    return {
        "property_id": property_id,
        "active_leases": int(row.get("active_leases") or 0),
        "total_leases": int(row.get("total_leases") or 0),
    }


def property_rental_history(cursor, property_id: int, *, limit: int = 50) -> list[dict[str, Any]]:
    lim = max(1, min(int(limit), 200))
    cursor.execute(
        """
        SELECT rp.id, rp.amount_wei, rp.amount_eth, rp.tx_hash, rp.payment_date, rp.payment_status,
               t.wallet_address AS tenant_wallet
        FROM rent_payments rp
        JOIN tenants t ON t.id = rp.tenant_id
        WHERE rp.property_id = %s
        ORDER BY rp.payment_date DESC, rp.id DESC
        LIMIT %s
        """,
        (property_id, lim),
    )
    return [jsonable(dict(r)) for r in cursor.fetchall() or []]
