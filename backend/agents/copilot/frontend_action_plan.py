"""Deterministic frontend execution plans (structured in-app actions only — no browser automation)."""
from __future__ import annotations

import re
from typing import Any

from backend.agents.copilot.client_navigation import (
    infer_investor_client_actions,
    infer_property_owner_client_actions,
    infer_tenant_client_actions,
)


def _norm(s: str) -> str:
    return " ".join((s or "").lower().split())


def _extract_new_property_name(user_message: str) -> str | None:
    msg = (user_message or "").strip()
    patterns = (
        r"(?:called|named)\s+[\"']([^\"'\n]+)[\"']",
        r"(?:called|named)\s+([A-Za-z0-9][^.,\n?!]{1,120})",
        r"(?:property|listing)\s+[\"']([^\"'\n]+)[\"']",
        r"create\s+(?:a\s+)?(?:new\s+)?property\s+(?:called|named)\s+([A-Za-z0-9][^.,\n?!]{1,120})",
    )
    for pat in patterns:
        m = re.search(pat, msg, re.I)
        if m:
            name = m.group(1).strip()
            if len(name) >= 2:
                return name[:200]
    return None


def _match_ranked_property_id(
    ranked: list[dict[str, Any]],
    hint: str | None,
    slot_id: int | None,
) -> int | None:
    if slot_id and slot_id > 0:
        return slot_id
    if not hint or not ranked:
        return None
    hn = _norm(hint)
    hn_compact = re.sub(r"\s+", "", hn)
    for r in ranked:
        name = str(r.get("name") or "").lower()
        if not name:
            continue
        n_compact = re.sub(r"\s+", "", name)
        try:
            pid = int(r.get("property_id") or 0)
        except (TypeError, ValueError):
            continue
        if pid <= 0:
            continue
        if hn in name or name in hn or hn_compact in n_compact or n_compact in hn_compact:
            return pid
    return None


def _parse_int_token_amount(slots: dict[str, Any]) -> int | None:
    raw = slots.get("token_amount_str") or slots.get("token_amount")
    if raw is None:
        return None
    try:
        n = int(float(str(raw)))
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _legacy_navigate_only(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for a in actions:
        if not isinstance(a, dict):
            continue
        if a.get("kind") != "navigate":
            continue
        path = str(a.get("path") or "")
        if not path.startswith("/"):
            continue
        q = a.get("query") if isinstance(a.get("query"), dict) else {}
        out.append({"type": "NAVIGATE", "route": path, "query": dict(q)})
    return out


def build_investor_frontend_actions(
    *,
    user_message: str,
    intent: str,
    slots: dict[str, Any],
    ranked: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Ordered UI plan for investor copilot."""
    t = _norm(user_message)
    actions: list[dict[str, Any]] = []

    wants_invest = intent == "invest_prepare" or (
        "token" in t and ("invest" in t or "buy" in t or "allocate" in t or "purchase" in t)
    )
    if wants_invest:
        hint = slots.get("property_name_hint")
        hint_s = str(hint).strip() if hint else None
        sid = slots.get("property_id")
        slot_id: int | None = None
        if isinstance(sid, int) and sid > 0:
            slot_id = sid
        elif isinstance(sid, str) and sid.isdigit():
            slot_id = int(sid)
        pid = _match_ranked_property_id(ranked, hint_s, slot_id)
        ta = _parse_int_token_amount(slots)
        query: dict[str, str] = {}
        if pid:
            query["copilot_invest"] = str(pid)
        if ta:
            query["copilot_tokens"] = str(ta)
        if hint_s and not pid:
            query["copilot_search"] = hint_s[:160]
        if query or wants_invest:
            actions.append({"type": "NAVIGATE", "route": "/investor/marketplace", "query": query})
        return actions

    legacy = infer_investor_client_actions(user_message=user_message, intent=intent)
    return _legacy_navigate_only(legacy)


def build_property_owner_frontend_actions(
    *,
    user_message: str,
    intent: str,
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    t = _norm(user_message)
    wants_create = any(
        x in t
        for x in (
            "add property",
            "create property",
            "new property",
            "list a property",
            "another property",
            "list another",
        )
    )
    if wants_create:
        name = _extract_new_property_name(user_message)
        if name:
            actions.append(
                {
                    "type": "FILL_FORM",
                    "form_id": "create_property",
                    "fields": {"name": name},
                }
            )
        legacy = infer_property_owner_client_actions(user_message=user_message, intent=intent)
        for a in _legacy_navigate_only(legacy):
            actions.append(a)
        return actions

    legacy = infer_property_owner_client_actions(user_message=user_message, intent=intent)
    return _legacy_navigate_only(legacy)


def build_tenant_frontend_actions(
    *,
    user_message: str,
    intent: str,
    intent_slots: dict[str, Any],
    working: dict[str, Any],
    interaction_mode: str,
    rent_prepare_ok: bool,
) -> list[dict[str, Any]]:
    """Pay-rent flows: navigate, open modal via query, optional auto-start through MetaMask prep."""
    legacy = infer_tenant_client_actions(
        user_message=user_message,
        intent=intent,
        intent_slots=intent_slots,
        working=working,
    )
    navs = _legacy_navigate_only(legacy)
    if not navs:
        return []
    out: list[dict[str, Any]] = []
    for n in navs:
        q = dict(n.get("query") or {})
        if (
            str(n.get("route") or "") == "/tenant/rentals"
            and interaction_mode == "execution"
            and rent_prepare_ok
            and q.get("copilot_pay")
        ):
            q["copilot_auto"] = "1"
        out.append({"type": "NAVIGATE", "route": n["route"], "query": q})
    return out
