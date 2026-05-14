"""Deterministic property / token hints for tx.prepare_* flows (shared across copilots)."""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any


def parse_token_amount(user_message: str) -> Decimal | None:
    m = re.search(r"(\d+(?:\.\d+)?)\s*tokens?\b", user_message or "", re.I)
    if not m:
        return None
    try:
        d = Decimal(m.group(1))
        return d if d > 0 else None
    except (InvalidOperation, ValueError):
        return None


def extract_property_and_token_slots(user_message: str) -> dict[str, Any]:
    """Parse property id, name hint, and token quantity from natural language."""
    slots: dict[str, Any] = {}
    t = " ".join((user_message or "").lower().split())
    mp = re.search(r"property\s*(?:id)?\s*[#:]?\s*(\d+)", t, re.I)
    if mp:
        slots["property_id"] = int(mp.group(1))
    mid = re.search(r"\b(?:property|id)\s+#?(\d+)\b", t, re.I)
    if mid and "property_id" not in slots:
        slots["property_id"] = int(mid.group(1))
    nm = re.search(r"\bin\s+([^.,?!]+?)(?:\s+with|\s+using|\s+token|\s*$)", t, re.I)
    if nm:
        hint = nm.group(1).strip()
        if len(hint) >= 2 and not hint.isdigit():
            slots["property_name_hint"] = hint[:160]
    tok = parse_token_amount(user_message or "")
    if tok is not None:
        slots["token_amount_str"] = str(tok)
    return slots
