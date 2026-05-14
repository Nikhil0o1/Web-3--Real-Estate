"""Heuristic intent routing for property-owner copilot turns."""
from __future__ import annotations

from typing import Any

_INTENT_ORDER: list[tuple[str, tuple[str, ...]]] = [
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
            return label, slots
        if any(n in t for n in needles):
            return label, slots
    return "operations_overview", slots
