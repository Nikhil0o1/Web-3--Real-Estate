"""Property-owner operational analytics (deterministic, explainable, read-only)."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from backend.agents.analytics.json import jsonable
from backend.services.blockchain import from_wei


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0


def _to_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except Exception:
        return Decimal(0)


def _properties(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        "SELECT id, name, location, token_supply, monthly_rent_wei, token_price_base "
        "FROM properties ORDER BY id DESC"
    )
    return [dict(r) for r in (cursor.fetchall() or [])]


def get_property_operational_metrics(cursor) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for prop in _properties(cursor):
        pid = int(prop["id"])
        cursor.execute(
            "SELECT COUNT(*) FILTER (WHERE status='active') AS active_cnt, COUNT(*) AS total_cnt "
            "FROM tenant_rentals WHERE property_id = %s",
            (pid,),
        )
        occ = cursor.fetchone() or {}
        active_rentals = _to_int(occ.get("active_cnt"))
        total_rentals = _to_int(occ.get("total_cnt"))
        occupancy_ratio = (
            Decimal(active_rentals) / Decimal(total_rentals) if total_rentals > 0 else Decimal(0)
        )

        cursor.execute(
            "SELECT COUNT(DISTINCT user_id) AS investor_cnt, "
            "COALESCE(SUM(CAST(token_amount AS DECIMAL(40,0))),0) AS tokens_held "
            "FROM token_ownerships WHERE property_id = %s AND token_amount > 0",
            (pid,),
        )
        inv = cursor.fetchone() or {}
        investor_count = _to_int(inv.get("investor_cnt"))
        tokens_held = _to_decimal(inv.get("tokens_held"))

        cursor.execute(
            "SELECT COALESCE(SUM(CAST(amount_wei AS DECIMAL(40,0))),0) AS collected_wei, "
            "COUNT(*) AS payment_cnt "
            "FROM rent_payments WHERE property_id = %s",
            (pid,),
        )
        rent = cursor.fetchone() or {}
        collected_wei = _to_int(rent.get("collected_wei"))
        payment_count = _to_int(rent.get("payment_cnt"))
        monthly_rent_wei = _to_int(prop.get("monthly_rent_wei"))
        token_supply = _to_decimal(prop.get("token_supply"))
        sold_ratio = (tokens_held / token_supply) if token_supply > 0 else Decimal(0)

        performance_score = (
            occupancy_ratio * Decimal("0.45")
            + min(Decimal(investor_count) / Decimal(30), Decimal(1)) * Decimal("0.30")
            + min(sold_ratio, Decimal(1)) * Decimal("0.25")
        )

        out.append(
            jsonable(
                {
                    "property_id": pid,
                    "name": prop.get("name"),
                    "location": prop.get("location"),
                    "active_rentals": active_rentals,
                    "total_rentals": total_rentals,
                    "occupancy_ratio": str(occupancy_ratio),
                    "investor_count": investor_count,
                    "tokens_held_base": str(tokens_held),
                    "sold_ratio": str(sold_ratio),
                    "monthly_rent_wei": str(monthly_rent_wei),
                    "monthly_rent_eth": str(from_wei(monthly_rent_wei)),
                    "rent_collected_wei": str(collected_wei),
                    "rent_collected_eth": str(from_wei(collected_wei)),
                    "payment_count": payment_count,
                    "performance_score": str(performance_score.quantize(Decimal("0.0001"))),
                }
            )
        )
    return out


def analyze_occupancy_trends(cursor, *, months: int = 6) -> list[dict[str, Any]]:
    months = max(2, min(int(months), 24))
    cursor.execute(
        """
        SELECT tr.property_id,
               DATE_TRUNC('month', COALESCE(tr.created_at, CURRENT_TIMESTAMP)) AS month_bucket,
               COUNT(*) FILTER (WHERE tr.status = 'active') AS active_count,
               COUNT(*) AS total_count
        FROM tenant_rentals tr
        WHERE COALESCE(tr.created_at, CURRENT_TIMESTAMP) >= (CURRENT_DATE - (%s::int * INTERVAL '1 month'))
        GROUP BY tr.property_id, DATE_TRUNC('month', COALESCE(tr.created_at, CURRENT_TIMESTAMP))
        ORDER BY tr.property_id, month_bucket
        """,
        (months,),
    )
    rows = cursor.fetchall() or []
    grouped: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        pid = int(row["property_id"])
        grouped.setdefault(pid, []).append(
            {
                "month": row["month_bucket"],
                "active_count": _to_int(row.get("active_count")),
                "total_count": _to_int(row.get("total_count")),
            }
        )

    out: list[dict[str, Any]] = []
    for pid, series in grouped.items():
        points = []
        for p in series:
            ratio = (
                Decimal(p["active_count"]) / Decimal(p["total_count"])
                if p["total_count"] > 0
                else Decimal(0)
            )
            points.append({"month": p["month"], "occupancy_ratio": str(ratio)})
        first = _to_decimal(points[0]["occupancy_ratio"]) if points else Decimal(0)
        last = _to_decimal(points[-1]["occupancy_ratio"]) if points else Decimal(0)
        if last > first + Decimal("0.05"):
            trend = "improving"
        elif last < first - Decimal("0.05"):
            trend = "declining"
        else:
            trend = "stable"
        out.append(
            jsonable(
                {
                    "property_id": pid,
                    "months_tracked": len(points),
                    "trend": trend,
                    "series": points,
                }
            )
        )
    return out


def forecast_property_revenue(cursor, *, months: int = 3) -> dict[str, Any]:
    months = max(1, min(int(months), 24))
    rows = []
    total_forecast_wei = 0
    for prop in _properties(cursor):
        pid = int(prop["id"])
        cursor.execute(
            """
            SELECT COALESCE(SUM(CAST(amount_wei AS DECIMAL(40,0))),0) AS collected_wei,
                   COUNT(DISTINCT DATE_TRUNC('month', payment_date)) AS month_count
            FROM rent_payments
            WHERE property_id = %s
              AND payment_date >= (CURRENT_DATE - INTERVAL '180 day')
            """,
            (pid,),
        )
        hist = cursor.fetchone() or {}
        collected_wei = _to_int(hist.get("collected_wei"))
        month_count = max(_to_int(hist.get("month_count")), 0)
        monthly_rent_wei = _to_int(prop.get("monthly_rent_wei"))
        avg_monthly_wei = int(collected_wei / month_count) if month_count > 0 else monthly_rent_wei
        projected_wei = avg_monthly_wei * months
        total_forecast_wei += projected_wei
        rows.append(
            {
                "property_id": pid,
                "name": prop.get("name"),
                "avg_monthly_revenue_wei": str(avg_monthly_wei),
                "avg_monthly_revenue_eth": str(from_wei(avg_monthly_wei)),
                "projected_revenue_wei": str(projected_wei),
                "projected_revenue_eth": str(from_wei(projected_wei)),
                "basis_months": month_count,
            }
        )
    return jsonable(
        {
            "horizon_months": months,
            "total_projected_revenue_wei": str(total_forecast_wei),
            "total_projected_revenue_eth": str(from_wei(total_forecast_wei)),
            "properties": rows,
        }
    )


def detect_underperforming_properties(
    operational_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    flagged: list[dict[str, Any]] = []
    for row in operational_rows:
        occ = _to_decimal(row.get("occupancy_ratio"))
        sold = _to_decimal(row.get("sold_ratio"))
        investor_count = _to_int(row.get("investor_count"))
        score = _to_decimal(row.get("performance_score"))
        signals: list[str] = []
        if occ < Decimal("0.6"):
            signals.append(f"occupancy ratio low ({occ})")
        if sold < Decimal("0.3"):
            signals.append(f"token distribution weak ({sold})")
        if investor_count < 2:
            signals.append("investor participation thin")
        if score < Decimal("0.35"):
            signals.append(f"overall performance score low ({score})")
        if signals:
            flagged.append(
                {
                    "property_id": row.get("property_id"),
                    "name": row.get("name"),
                    "performance_score": row.get("performance_score"),
                    "signals": signals,
                }
            )
    flagged.sort(key=lambda r: _to_decimal(r.get("performance_score")))
    return jsonable(flagged)


def analyze_investor_distribution(cursor) -> list[dict[str, Any]]:
    cursor.execute(
        """
        SELECT property_id,
               COUNT(DISTINCT user_id) AS investor_count,
               COALESCE(SUM(CAST(token_amount AS DECIMAL(40,0))),0) AS total_tokens,
               COALESCE(MAX(CAST(token_amount AS DECIMAL(40,0))),0) AS max_holder_tokens
        FROM token_ownerships
        WHERE token_amount > 0
        GROUP BY property_id
        ORDER BY property_id
        """
    )
    rows = cursor.fetchall() or []
    out = []
    for row in rows:
        total = _to_decimal(row.get("total_tokens"))
        max_holder = _to_decimal(row.get("max_holder_tokens"))
        concentration = (max_holder / total) if total > 0 else Decimal(0)
        out.append(
            {
                "property_id": int(row["property_id"]),
                "investor_count": _to_int(row.get("investor_count")),
                "total_tokens_base": str(total),
                "largest_holder_concentration": str(concentration),
            }
        )
    return jsonable(out)


def suggest_pricing_improvements(
    operational_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    recommendations: list[dict[str, Any]] = []
    for row in operational_rows:
        occ = _to_decimal(row.get("occupancy_ratio"))
        sold = _to_decimal(row.get("sold_ratio"))
        monthly_rent_eth = row.get("monthly_rent_eth")
        action = "maintain_pricing"
        rationale = "Current occupancy and participation are balanced."
        if occ < Decimal("0.55"):
            action = "consider_rent_reduction"
            rationale = "Occupancy is weak; a modest pricing reduction can improve lease velocity."
        elif occ > Decimal("0.9") and sold > Decimal("0.75"):
            action = "consider_rent_increase"
            rationale = "Occupancy and investor demand are strong; room for incremental pricing increase."
        recommendations.append(
            {
                "property_id": row.get("property_id"),
                "name": row.get("name"),
                "monthly_rent_eth": monthly_rent_eth,
                "recommended_action": action,
                "rationale": rationale,
            }
        )
    return jsonable(recommendations)
