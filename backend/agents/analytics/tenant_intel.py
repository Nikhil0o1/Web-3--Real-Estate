"""Tenant-facing rental analytics (deterministic + explainable)."""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from backend.agents.analytics.json import jsonable
from backend.services.auth import normalize_address
from backend.services.blockchain import from_wei, get_native_balance, get_web3


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


def get_tenant_payment_summary(cursor, *, wallet_address: str) -> dict[str, Any]:
    checksum = normalize_address(wallet_address)
    cursor.execute(
        """
        SELECT COALESCE(SUM(CAST(rp.amount_wei AS DECIMAL(40,0))),0) AS total_paid_wei,
               COUNT(*) AS payment_count,
               MAX(rp.payment_date) AS last_payment_date,
               COUNT(DISTINCT rp.property_id) AS properties_paid
        FROM rent_payments rp
        JOIN tenants t ON t.id = rp.tenant_id
        WHERE LOWER(t.wallet_address) = LOWER(%s)
        """,
        (checksum,),
    )
    row = cursor.fetchone() or {}
    total_paid_wei = _to_int(row.get("total_paid_wei"))
    return jsonable(
        {
            "wallet_address": checksum,
            "payment_count": _to_int(row.get("payment_count")),
            "properties_paid": _to_int(row.get("properties_paid")),
            "total_paid_wei": str(total_paid_wei),
            "total_paid_eth": str(from_wei(total_paid_wei)),
            "last_payment_date": row.get("last_payment_date"),
        }
    )


def forecast_rent_obligations(
    cursor,
    *,
    wallet_address: str,
    months: int = 3,
) -> dict[str, Any]:
    checksum = normalize_address(wallet_address)
    months = max(1, min(int(months), 24))
    cursor.execute(
        """
        SELECT tr.property_id, p.name AS property_name, COALESCE(p.monthly_rent_wei, '0') AS monthly_rent_wei
        FROM tenant_rentals tr
        JOIN tenants t ON t.id = tr.tenant_id
        JOIN properties p ON p.id = tr.property_id
        WHERE LOWER(t.wallet_address) = LOWER(%s) AND tr.status = 'active'
        ORDER BY tr.created_at DESC
        """,
        (checksum,),
    )
    rows = cursor.fetchall() or []
    monthly_total_wei = 0
    breakdown = []
    for r in rows:
        monthly_wei = _to_int(r.get("monthly_rent_wei"))
        monthly_total_wei += monthly_wei
        breakdown.append(
            {
                "property_id": _to_int(r.get("property_id")),
                "property_name": r.get("property_name"),
                "monthly_rent_wei": str(monthly_wei),
                "monthly_rent_eth": str(from_wei(monthly_wei)),
                "projected_total_wei": str(monthly_wei * months),
                "projected_total_eth": str(from_wei(monthly_wei * months)),
            }
        )
    projected_total_wei = monthly_total_wei * months
    return jsonable(
        {
            "wallet_address": checksum,
            "horizon_months": months,
            "active_rentals": len(rows),
            "monthly_obligation_wei": str(monthly_total_wei),
            "monthly_obligation_eth": str(from_wei(monthly_total_wei)),
            "projected_total_wei": str(projected_total_wei),
            "projected_total_eth": str(from_wei(projected_total_wei)),
            "breakdown": breakdown,
        }
    )


def analyze_payment_behavior(cursor, *, wallet_address: str, months: int = 6) -> dict[str, Any]:
    checksum = normalize_address(wallet_address)
    months = max(3, min(int(months), 24))
    cursor.execute(
        """
        SELECT DATE_TRUNC('month', rp.payment_date) AS month_bucket,
               COUNT(*) AS payment_count,
               COALESCE(SUM(CAST(rp.amount_wei AS DECIMAL(40,0))),0) AS paid_wei
        FROM rent_payments rp
        JOIN tenants t ON t.id = rp.tenant_id
        WHERE LOWER(t.wallet_address) = LOWER(%s)
          AND rp.payment_date >= (CURRENT_DATE - (%s::int * INTERVAL '1 month'))
        GROUP BY DATE_TRUNC('month', rp.payment_date)
        ORDER BY month_bucket ASC
        """,
        (checksum, months),
    )
    rows = cursor.fetchall() or []
    series = [
        {
            "month": r.get("month_bucket"),
            "payment_count": _to_int(r.get("payment_count")),
            "paid_wei": str(_to_int(r.get("paid_wei"))),
            "paid_eth": str(from_wei(_to_int(r.get("paid_wei")))),
        }
        for r in rows
    ]
    months_with_payment = sum(1 for r in series if _to_int(r.get("payment_count")) > 0)
    consistency_ratio = (
        Decimal(months_with_payment) / Decimal(months) if months > 0 else Decimal(0)
    )
    return jsonable(
        {
            "wallet_address": checksum,
            "window_months": months,
            "months_with_payment": months_with_payment,
            "consistency_ratio": str(consistency_ratio),
            "series": series,
        }
    )


def calculate_affordability_metrics(cursor, *, wallet_address: str) -> dict[str, Any]:
    checksum = normalize_address(wallet_address)
    obligations = forecast_rent_obligations(cursor, wallet_address=checksum, months=1)
    monthly_obligation_wei = _to_int(obligations.get("monthly_obligation_wei"))

    native_balance_wei = 0
    balance_error = None
    try:
        web3 = get_web3()
        if web3.is_address(checksum):
            native_balance_wei = int(get_native_balance(web3.to_checksum_address(checksum)))
    except Exception as exc:  # noqa: BLE001
        balance_error = str(exc)

    coverage_months = (
        Decimal(native_balance_wei) / Decimal(monthly_obligation_wei)
        if monthly_obligation_wei > 0
        else None
    )
    if coverage_months is None:
        health = "no_active_obligation"
    elif coverage_months >= Decimal("6"):
        health = "healthy"
    elif coverage_months >= Decimal("3"):
        health = "moderate"
    else:
        health = "tight"

    return jsonable(
        {
            "wallet_address": checksum,
            "native_balance_wei": str(native_balance_wei),
            "native_balance_eth": str(from_wei(native_balance_wei)),
            "monthly_obligation_wei": str(monthly_obligation_wei),
            "monthly_obligation_eth": str(from_wei(monthly_obligation_wei)),
            "coverage_months": str(coverage_months) if coverage_months is not None else None,
            "affordability_health": health,
            "balance_error": balance_error,
        }
    )


def get_next_payment_reminder(cursor, *, wallet_address: str) -> dict[str, Any]:
    checksum = normalize_address(wallet_address)
    obligations = forecast_rent_obligations(cursor, wallet_address=checksum, months=1)
    monthly_obligation_wei = _to_int(obligations.get("monthly_obligation_wei"))
    today = date.today()
    if today.month == 12:
        next_due = date(today.year + 1, 1, 1)
    else:
        next_due = date(today.year, today.month + 1, 1)
    return jsonable(
        {
            "wallet_address": checksum,
            "next_due_date": next_due,
            "monthly_obligation_wei": str(monthly_obligation_wei),
            "monthly_obligation_eth": str(from_wei(monthly_obligation_wei)),
            "active_rentals": _to_int(obligations.get("active_rentals")),
            "message": (
                "No active rental payments due."
                if monthly_obligation_wei <= 0
                else "Upcoming rent obligation detected."
            ),
        }
    )
