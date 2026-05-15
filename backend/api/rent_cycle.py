"""Rent billing period helpers — one calendar month per payment (anniversary-based)."""
from __future__ import annotations

import calendar
from datetime import datetime
from typing import Any


def add_one_calendar_month(dt: datetime) -> datetime:
    """Advance by one calendar month, clamping day (e.g. Jan 31 → Feb 28)."""
    if dt.month == 12:
        year, month = dt.year + 1, 1
    else:
        year, month = dt.year, dt.month + 1
    max_day = calendar.monthrange(year, month)[1]
    day = min(dt.day, max_day)
    return dt.replace(year=year, month=month, day=day)


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo else value
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1]
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def get_last_confirmed_rent_payment(cursor, tenant_id: int, property_id: int) -> dict | None:
    cursor.execute(
        "SELECT id, payment_date, amount_wei, rent_month, rent_year "
        "FROM rent_payments "
        "WHERE tenant_id = %s AND property_id = %s AND payment_status = 'confirmed' "
        "ORDER BY payment_date DESC LIMIT 1",
        (tenant_id, property_id),
    )
    row = cursor.fetchone()
    return dict(row) if row else None


def get_last_confirmed_rent_payment_by_wallet(
    cursor, tenant_wallet: str, property_id: int
) -> dict | None:
    cursor.execute(
        "SELECT rp.id, rp.payment_date, rp.amount_wei, rp.rent_month, rp.rent_year "
        "FROM rent_payments rp "
        "JOIN tenants t ON t.id = rp.tenant_id "
        "WHERE LOWER(t.wallet_address) = LOWER(%s) AND rp.property_id = %s "
        "AND rp.payment_status = 'confirmed' "
        "ORDER BY rp.payment_date DESC LIMIT 1",
        (tenant_wallet, property_id),
    )
    row = cursor.fetchone()
    return dict(row) if row else None


def compute_rent_period_status(
    last_payment: dict | None,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Derive paid flag and next due from the latest confirmed payment."""
    now = now or datetime.utcnow()
    if not last_payment:
        return {
            "current_cycle_paid": False,
            "can_pay_rent": True,
            "next_due_at": now,
            "last_paid_at": None,
            "rent_cycle_label": "Due now",
        }

    paid_at = _coerce_datetime(last_payment.get("payment_date"))
    if not paid_at:
        return {
            "current_cycle_paid": False,
            "can_pay_rent": True,
            "next_due_at": now,
            "last_paid_at": None,
            "rent_cycle_label": "Due now",
        }

    next_due = add_one_calendar_month(paid_at)
    current_cycle_paid = now < next_due
    return {
        "current_cycle_paid": current_cycle_paid,
        "can_pay_rent": not current_cycle_paid,
        "next_due_at": next_due,
        "last_paid_at": paid_at,
        "rent_cycle_label": (
            f"Paid — next due {next_due.strftime('%B %d, %Y')}"
            if current_cycle_paid
            else f"Due {next_due.strftime('%B %d, %Y')}"
        ),
    }


def serialize_period_fields(status: dict[str, Any]) -> dict[str, Any]:
    """JSON-friendly timestamps for API responses."""
    next_due = status.get("next_due_at")
    last_paid = status.get("last_paid_at")
    return {
        "current_cycle_paid": bool(status.get("current_cycle_paid")),
        "can_pay_rent": bool(status.get("can_pay_rent", not status.get("current_cycle_paid"))),
        "next_rent_due_at": next_due.isoformat() if isinstance(next_due, datetime) else None,
        "last_rent_paid_at": last_paid.isoformat() if isinstance(last_paid, datetime) else None,
        "rent_cycle_label": status.get("rent_cycle_label") or "",
    }
