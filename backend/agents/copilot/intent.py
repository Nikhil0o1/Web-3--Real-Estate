"""Heuristic natural-language intent for investor orchestration (deterministic)."""
from __future__ import annotations

import re
from typing import Any

from backend.agents.copilot.tx_slot_hints import extract_property_and_token_slots

_INTENT_ORDER: list[tuple[str, tuple[str, ...]]] = [
    ("invest_prepare", ("invest ", "buy ", "allocate ", "put ", " eth", "eth ", "purchase", "subscribe")),
    ("best_yield", ("best yield", "highest yield", "top yield", "passive income opportunity", "income opportunity")),
    ("discover_opportunities", ("discover", "find properties", "opportunities", "marketplace", "low risk", "safest")),
    ("portfolio_risk", ("risk", "volatile", "concentration", "exposure")),
    ("diversification", ("diversif", "spread", "allocate across")),
    ("passive_income", ("passive income", "projection", "income projection", "yield projection")),
    ("reinvest_question", ("reinvest", "re-invest", "claim rewards", "should i claim")),
    ("compare_holdings", ("compare", "holdings", "versus", " vs ")),
    ("general", ()),
]


def _norm(s: str) -> str:
    return " ".join(s.lower().split())


def classify_investor_intent(user_message: str) -> tuple[str, dict[str, Any]]:
    """Return (intent_label, slots). Slots may include parsed eth amount, property hints."""
    t = _norm(user_message)
    slots: dict[str, Any] = {}
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:eth|ether)\b", t, re.I)
    if m:
        slots["eth_amount"] = m.group(1)
    mp = re.search(r"property\s*(?:id)?\s*[#:]?\s*(\d+)", t, re.I)
    if mp:
        slots["property_id"] = int(mp.group(1))
    mid = re.search(r"\b(?:property|id)\s+#?(\d+)\b", t, re.I)
    if mid and "property_id" not in slots:
        slots["property_id"] = int(mid.group(1))
    # "Invest 1 token in Azure Views" → name hint for UX / future resolver
    nm = re.search(r"\bin\s+([^.,?!]+?)(?:\s+with|\s+using|\s+token|\s*$)", t, re.I)
    if nm:
        hint = nm.group(1).strip()
        if len(hint) >= 2 and not hint.isdigit():
            slots["property_name_hint"] = hint[:160]
    intent_label = "general"
    for label, needles in _INTENT_ORDER:
        if label == "general":
            break
        if any(n in t for n in needles):
            intent_label = label
            break
    extra = extract_property_and_token_slots(user_message)
    merged = {**slots}
    for k, v in extra.items():
        if k not in merged or merged.get(k) in (None, ""):
            merged[k] = v
    return intent_label, merged
