"""Heuristic intent routing for tenant copilot turns."""
from __future__ import annotations

from typing import Any

from backend.agents.copilot.tx_slot_hints import extract_property_and_token_slots

_INTENT_ORDER: list[tuple[str, tuple[str, ...]]] = [
    (
        "rent_pay_prepare",
        (
            "pay my rent",
            "pay rent",
            "pay the rent",
            "submit rent",
            "rent payment now",
            "send rent",
            "pay monthly rent",
        ),
    ),
    ("rent_reminder", ("next payment", "rent reminder", "payment due", "due date")),
    ("payment_summary", ("payment history", "payment summary", "recent payments", "rental history")),
    ("affordability_analysis", ("afford", "affordability", "can i afford", "budget")),
    ("rent_forecast", ("forecast rent", "future obligations", "upcoming rent", "next months")),
    ("rental_assistance", ("help", "assistance", "which property", "rent support")),
    ("tenant_overview", ()),
]


def classify_tenant_intent(user_message: str) -> tuple[str, dict[str, Any]]:
    t = " ".join((user_message or "").lower().split())
    slots: dict[str, Any] = {}
    for label, needles in _INTENT_ORDER:
        if not needles:
            merged = {**extract_property_and_token_slots(user_message), **slots}
            return label, merged
        if any(n in t for n in needles):
            merged = {**extract_property_and_token_slots(user_message), **slots}
            return label, merged
    merged = {**extract_property_and_token_slots(user_message), **slots}
    return "tenant_overview", merged
