"""Heuristic intent routing for property-owner copilot turns."""
from __future__ import annotations

from typing import Any

from backend.agents.copilot.tx_slot_hints import extract_property_and_token_slots

_INTENT_ORDER: list[tuple[str, tuple[str, ...]]] = [
    (
        "invest_prepare",
        ("invest ", "buy ", "allocate ", "put ", "purchase", "subscribe", " token"),
    ),
    ("occupancy_analysis", ("occupancy", "vacancy", "lease rate", "active rentals")),
    ("underperforming_detection", ("underperform", "weak property", "lagging", "decline")),
    ("revenue_forecast", ("forecast", "next quarter", "projection", "revenue")),
    ("investor_participation", ("investor", "participation", "engagement", "distribution")),
    ("pricing_optimization", ("pricing", "price", "rent increase", "rent decrease", "optimize rent")),
    ("operations_overview", ()),
]


def classify_property_owner_intent(user_message: str) -> tuple[str, dict[str, Any]]:
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
    return "operations_overview", merged
