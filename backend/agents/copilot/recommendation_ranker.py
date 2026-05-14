"""Explainable, deterministic opportunity ranking from orchestrated analytics."""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


def _dec(x: Any) -> Decimal:
    try:
        return Decimal(str(x or "0"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(0)


def rank_investment_opportunities(
    *,
    low_risk_rows: list[dict[str, Any]],
    top_yield_rows: list[dict[str, Any]],
    portfolio_property_ids: set[int],
    limit: int = 8,
) -> list[dict[str, Any]]:
    """Merge marketplace signals with diversification fit; higher score = better ranked."""
    by_id: dict[int, dict[str, Any]] = {}
    for row in low_risk_rows:
        pid = int(row.get("id") or row.get("property_id") or 0)
        if pid <= 0:
            continue
        by_id[pid] = {
            "property_id": pid,
            "name": row.get("name") or row.get("title"),
            "low_risk_score": _dec(row.get("score") or row.get("risk_score") or 0),
            "yield_proxy": _dec(row.get("yield_proxy") or row.get("annual_yield_proxy") or 0),
            "sold_ratio": _dec(row.get("sold_ratio") or 0),
            "sources": ["marketplace.low_risk_properties"],
        }
    for row in top_yield_rows:
        pid = int(row.get("id") or row.get("property_id") or 0)
        if pid <= 0:
            continue
        cur = by_id.setdefault(
            pid,
            {
                "property_id": pid,
                "name": row.get("name") or row.get("title"),
                "low_risk_score": Decimal(0),
                "yield_proxy": Decimal(0),
                "sold_ratio": Decimal(0),
                "sources": [],
            },
        )
        y = _dec(row.get("yield_proxy") or row.get("annual_yield_proxy") or 0)
        if y > cur["yield_proxy"]:
            cur["yield_proxy"] = y
        if "marketplace.top_yielding_properties" not in cur["sources"]:
            cur["sources"].append("marketplace.top_yielding_properties")

    out: list[dict[str, Any]] = []
    for pid, rec in by_id.items():
        div_bonus = Decimal("0.15") if pid not in portfolio_property_ids else Decimal(0)
        # Weighted heuristic: yield + sold/stability + low-risk module score + diversification
        score = (
            rec["yield_proxy"] * Decimal("1.0")
            + rec["sold_ratio"] * Decimal("0.5")
            + rec["low_risk_score"] * Decimal("0.3")
            + div_bonus
        )
        rec["rank_score"] = str(score.quantize(Decimal("0.0001")))
        rec["diversification_fit"] = pid not in portfolio_property_ids
        rec["why"] = (
            f"Score blends yield proxy ({rec['yield_proxy']}), sold_ratio ({rec['sold_ratio']}), "
            f"low-risk module ({rec['low_risk_score']}), "
            f"{'plus diversification bonus (not already held)' if rec['diversification_fit'] else 'already in portfolio'}."
        )
        out.append(rec)
    out.sort(key=lambda r: _dec(r.get("rank_score")), reverse=True)
    return out[:limit]
