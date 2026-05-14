"""Deterministic UI navigation hints for copilot structured responses (non-custodial).

The browser executes these (router.push, open dialogs). No signing or key access.
"""
from __future__ import annotations

import re
from typing import Any


def _norm(s: str) -> str:
    return " ".join((s or "").lower().split())


def infer_investor_client_actions(*, user_message: str, intent: str) -> list[dict[str, Any]]:
    t = _norm(user_message)
    out: list[dict[str, Any]] = []
    if any(x in t for x in ("transaction", "transactions", "payment history", "tx history", "last 3", "last three")):
        out.append({"kind": "navigate", "path": "/investor/transactions", "query": {}})
    if any(
        x in t
        for x in (
            "marketplace",
            "buy token",
            "invest in",
            "opportunit",
            "discover propert",
            "add property",
            "add a property",
            "new property",
            "one more property",
            "another property",
            "buy another",
            "invest in another",
            "list another",
        )
    ):
        out.append({"kind": "navigate", "path": "/investor/marketplace", "query": {}})
    if "portfolio" in t or intent in {"compare_holdings", "diversification", "portfolio_risk"}:
        out.append({"kind": "navigate", "path": "/investor/portfolio", "query": {}})
    return out


def infer_property_owner_client_actions(*, user_message: str, intent: str) -> list[dict[str, Any]]:
    t = _norm(user_message)
    out: list[dict[str, Any]] = []
    if any(
        x in t
        for x in (
            "add property",
            "create property",
            "new property",
            "list a property",
            "another property",
            "list another",
        )
    ):
        out.append({"kind": "navigate", "path": "/property_owner/properties", "query": {"copilot_open": "create_property"}})
    if any(x in t for x in ("transaction", "transactions", "last 3", "last three", "recent tx", "payment log")):
        out.append({"kind": "navigate", "path": "/property_owner/transactions", "query": {}})
    if "analytics" in t or intent in {"revenue_forecast", "occupancy_analysis", "underperforming_detection"}:
        out.append({"kind": "navigate", "path": "/property_owner/analytics", "query": {}})
    return out


def _unwrap_rentals(working: dict[str, Any]) -> list[dict[str, Any]]:
    raw = working.get("tenant.active_rentals") or {}
    inner = raw.get("result") if isinstance(raw, dict) else None
    if isinstance(inner, list):
        return [r for r in inner if isinstance(r, dict)]
    return []


def infer_tenant_client_actions(
    *,
    user_message: str,
    intent: str,
    intent_slots: dict[str, Any],
    working: dict[str, Any],
) -> list[dict[str, Any]]:
    t = _norm(user_message)
    out: list[dict[str, Any]] = []
    wants_pay = ("pay" in t and "rent" in t) or intent == "rent_pay_prepare"
    if not wants_pay:
        return out

    slots = dict(intent_slots or {})
    pid = slots.get("property_id")
    if isinstance(pid, str) and pid.isdigit():
        pid = int(pid)
    if isinstance(pid, int) and pid > 0:
        out.append({"kind": "navigate", "path": "/tenant/rentals", "query": {"copilot_pay": str(pid)}})
        return out

    hint = str(slots.get("property_name_hint") or "").strip().lower()
    if hint:
        for r in _unwrap_rentals(working):
            name = str(r.get("property_name") or "").lower()
            try:
                rid = int(r.get("property_id") or 0)
            except (TypeError, ValueError):
                continue
            if rid <= 0:
                continue
            if hint in name or name in hint or re.sub(r"\s+", "", hint) in re.sub(r"\s+", "", name):
                out.append({"kind": "navigate", "path": "/tenant/rentals", "query": {"copilot_pay": str(rid)}})
                return out

    rentals = _unwrap_rentals(working)
    if len(rentals) == 1:
        try:
            rid = int(rentals[0].get("property_id") or 0)
        except (TypeError, ValueError):
            rid = 0
        if rid > 0:
            out.append({"kind": "navigate", "path": "/tenant/rentals", "query": {"copilot_pay": str(rid)}})
    else:
        out.append({"kind": "navigate", "path": "/tenant/rentals", "query": {}})
    return out
