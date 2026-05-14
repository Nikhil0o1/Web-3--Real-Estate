"""Execution vs advisory routing — deterministic, orchestration-safe (Phase 11).

``execution`` mode signals the UI it may auto-open MetaMask *after* a prepared
payload exists. The backend never signs; wallet approval remains mandatory.
"""
from __future__ import annotations

import re
from typing import Any, Literal

Role = Literal["investor", "tenant", "property_owner"]

_ADVISORY_HINTS = (
    "how ",
    "what ",
    "why ",
    "explain",
    "analyze",
    "analyse",
    "diversif",
    "compare ",
    " risk",
    "volatile",
    "projection",
    "should i",
    "worth it",
    "tell me about",
)
_EXECUTION_HINTS = (
    "pay my rent",
    "pay rent",
    "pay the rent",
    "claim my reward",
    "claim reward",
    "claim the reward",
    "invest ",
    "buy ",
    "allocate ",
    "put ",
    "send ",
    "execute ",
    "sign ",
    "wallet balance",
    "show my balance",
    "show balance",
    "my balance",
)


def _norm(s: str) -> str:
    return " ".join((s or "").lower().split())


def enrich_intent_slots_with_execution_route(
    *,
    role: Role,
    user_message: str,
    intent_label: str,
    slots: dict[str, Any],
) -> dict[str, Any]:
    """Return a copy of ``slots`` with ``interaction_mode`` + ``execution_confidence``."""
    out = dict(slots)
    t = _norm(user_message)
    mode: Literal["advisory", "execution"] = "advisory"
    confidence = 0.35

    adv = any(h in t for h in _ADVISORY_HINTS)
    exe = any(h in t for h in _EXECUTION_HINTS)

    if role == "investor":
        if intent_label == "invest_prepare" and re.search(r"\d", t):
            if exe or ("token" in t or " eth" in t or "ether" in t):
                if not (adv and t.rstrip().endswith("?")):
                    mode, confidence = "execution", 0.88
        if intent_label in {"best_yield", "discover_opportunities", "portfolio_risk", "diversification", "passive_income"}:
            if exe and not adv:
                mode, confidence = "execution", 0.55
        if not adv and any(
            x in t for x in ("wallet balance", "show my balance", "show balance", "my balance", "my wallet balance")
        ):
            mode, confidence = "execution", 0.62

    if role == "property_owner" and intent_label == "invest_prepare" and re.search(r"\d", t):
        if exe or ("token" in t or " eth" in t or "ether" in t):
            if not (adv and t.rstrip().endswith("?")):
                mode, confidence = "execution", 0.88

    if role == "tenant" and intent_label == "rent_pay_prepare":
        mode, confidence = "execution", 0.9
    elif role == "tenant" and exe and ("rent" in t or "payment" in t):
        mode, confidence = "execution", 0.72

    if role == "property_owner" and exe and any(
        x in t for x in ("distribute", "payout", "withdraw", "collect rent", "mint")
    ):
        mode, confidence = "execution", 0.55

    out["interaction_mode"] = mode
    out["execution_confidence"] = confidence
    return out
