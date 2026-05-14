"""Yield / ROI style metrics — deterministic from DB fields (not forward-looking promises)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from backend.agents.analytics.json import jsonable
from backend.api._helpers import fetch_property
from backend.services.blockchain import from_wei


def _wei_to_eth_str(wei: str | None) -> Decimal:
    if not wei:
        return Decimal(0)
    try:
        return from_wei(int(str(wei)))
    except Exception:
        return Decimal(0)


def analyze_property_roi(cursor, *, property_id: int) -> dict[str, Any] | None:
    row = fetch_property(cursor, property_id)
    if not row:
        return None
    d = dict(row)
    monthly_rent_eth = _wei_to_eth_str(d.get("monthly_rent_wei"))
    token_price_eth = _wei_to_eth_str(d.get("token_price_base"))
    total_value = Decimal(str(d.get("total_value") or 0))
    token_supply = Decimal(str(d.get("token_supply") or 0))
    cursor.execute(
        "SELECT COALESCE(SUM(token_amount),0) AS sold FROM token_ownerships WHERE property_id = %s",
        (property_id,),
    )
    sold_tokens = Decimal(str((cursor.fetchone() or {}).get("sold") or 0))
    sold_ratio = (sold_tokens / token_supply) if token_supply > 0 else Decimal(0)
    # Simple annualized rent / book value proxy when total_value > 0 (DB total_value is listing/book metric).
    annual_rent = monthly_rent_eth * Decimal(12)
    cap_proxy = (annual_rent / total_value) if total_value > 0 else None
    return jsonable(
        {
            "property_id": property_id,
            "name": d.get("name"),
            "monthly_rent_eth": str(monthly_rent_eth),
            "token_sale_price_eth": str(token_price_eth),
            "total_value_book": str(total_value),
            "token_supply": str(token_supply),
            "sold_tokens": str(sold_tokens),
            "sold_ratio": str(sold_ratio),
            "annual_rent_eth_estimate": str(annual_rent),
            "annual_rent_to_book_value": str(cap_proxy) if cap_proxy is not None else None,
            "disclaimer": "Heuristic analytics from DB + on-chain list price fields; not investment advice.",
        }
    )


def forecast_rental_yield(
    *,
    monthly_rent_eth: Decimal,
    basis_eth: Decimal,
) -> dict[str, Any]:
    """Annual rent / capital basis — explicit inputs only (no guessing wallet balances)."""
    if basis_eth <= 0:
        return {"annual_yield": None, "error": "basis_eth_must_be_positive"}
    annual = monthly_rent_eth * Decimal(12)
    y = annual / basis_eth
    return {"annual_yield": str(y), "annual_rent_eth": str(annual), "basis_eth": str(basis_eth)}


def expected_passive_income_from_holdings(
    *,
    token_amount: Decimal,
    monthly_rent_eth: Decimal,
    token_supply: Decimal,
) -> dict[str, Any]:
    if token_supply <= 0:
        return {"expected_monthly_eth": None, "error": "invalid_token_supply"}
    share = token_amount / token_supply
    return {
        "ownership_share": str(share),
        "expected_monthly_eth": str(monthly_rent_eth * share),
        "expected_annual_eth": str(monthly_rent_eth * share * Decimal(12)),
    }


def compare_properties_by_roi(cursor, property_ids: list[int]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for pid in sorted(set(property_ids))[:20]:
        r = analyze_property_roi(cursor, property_id=int(pid))
        if r:
            out.append(r)
    return out
