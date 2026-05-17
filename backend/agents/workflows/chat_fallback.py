"""Conversational chat fallback for the workflow graph.

When no executable workflow matches the user's message, we still want a useful
spoken reply — Jarvis-style. This module fetches a compact, role-aware snapshot
of the user's data and asks the configured LLM to answer concisely.
"""
from __future__ import annotations

import json
from typing import Any

from backend.agents.config.providers import get_completion_router
from backend.agents.config.settings import get_ai_settings


def _fetch_rows(db: Any, sql: str, params: tuple) -> list[dict[str, Any]]:
    if db is None:
        return []
    try:
        cur = db.cursor(dictionary=True)
    except Exception:  # noqa: BLE001
        return []
    try:
        cur.execute(sql, params)
        rows = cur.fetchall() or []
        return [dict(r) for r in rows]
    except Exception:  # noqa: BLE001
        return []
    finally:
        try:
            cur.close()
        except Exception:  # noqa: BLE001
            pass


def _serialize(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _row_summary(row: dict[str, Any], keys: list[str]) -> dict[str, Any]:
    return {k: _serialize(row.get(k)) for k in keys if k in row}


def _investor_context(db: Any, wallet: str) -> dict[str, Any]:
    if not wallet:
        return {}
    investments = _fetch_rows(
        db,
        """
        SELECT i.id, i.property_id, p.name AS property_name, i.token_amount_base,
               i.eth_amount_wei, i.status, i.deposit_tx_hash, i.created_at
        FROM investments i
        LEFT JOIN properties p ON p.id = i.property_id
        WHERE LOWER(i.investor_wallet) = LOWER(%s)
        ORDER BY i.created_at DESC
        LIMIT 8
        """,
        (wallet,),
    )
    transactions = _fetch_rows(
        db,
        """
        SELECT tx_hash, type, amount, timestamp, property_id, block_number
        FROM transactions
        WHERE LOWER(wallet_address) = LOWER(%s)
        ORDER BY timestamp DESC
        LIMIT 10
        """,
        (wallet,),
    )
    payouts = _fetch_rows(
        db,
        """
        SELECT property_id, payout_eth_wei, claim_status, distribution_id
        FROM investor_rent_payouts
        WHERE LOWER(investor_wallet) = LOWER(%s)
        ORDER BY id DESC
        LIMIT 10
        """,
        (wallet,),
    )
    return {
        "investments": [
            _row_summary(r, ["id", "property_id", "property_name", "token_amount_base",
                             "eth_amount_wei", "status", "deposit_tx_hash", "created_at"])
            for r in investments
        ],
        "recent_transactions": [
            _row_summary(r, ["tx_hash", "type", "amount", "timestamp", "property_id", "block_number"])
            for r in transactions
        ],
        "rent_payouts": [
            _row_summary(r, ["property_id", "payout_eth_wei", "claim_status", "distribution_id"])
            for r in payouts
        ],
    }


def _property_owner_context(db: Any, wallet: str) -> dict[str, Any]:
    _ = wallet  # owner role currently has visibility over all properties
    properties = _fetch_rows(
        db,
        """
        SELECT id, name, location, total_value, token_supply, token_symbol,
               token_address, monthly_rent_eth, is_active, created_at
        FROM properties
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 12
        """,
        (),
    )
    rent_summary = _fetch_rows(
        db,
        """
        SELECT property_id, COUNT(*) AS payments, SUM(CAST(amount AS NUMERIC)) AS total_amount
        FROM rent_payments
        WHERE payment_status = 'confirmed'
        GROUP BY property_id
        ORDER BY total_amount DESC NULLS LAST
        LIMIT 10
        """,
        (),
    )
    transactions = _fetch_rows(
        db,
        """
        SELECT tx_hash, type, amount, timestamp, property_id, wallet_address
        FROM transactions
        ORDER BY timestamp DESC
        LIMIT 8
        """,
        (),
    )
    return {
        "properties": [
            _row_summary(r, ["id", "name", "location", "total_value", "token_supply",
                             "token_symbol", "token_address", "monthly_rent_eth",
                             "is_active", "created_at"])
            for r in properties
        ],
        "rent_summary": [
            _row_summary(r, ["property_id", "payments", "total_amount"]) for r in rent_summary
        ],
        "recent_transactions": [
            _row_summary(r, ["tx_hash", "type", "amount", "timestamp", "property_id", "wallet_address"])
            for r in transactions
        ],
    }


def _tenant_context(db: Any, wallet: str) -> dict[str, Any]:
    if not wallet:
        return {}
    rentals = _fetch_rows(
        db,
        """
        SELECT tr.id, tr.property_id, p.name AS property_name, p.monthly_rent_eth,
               tr.status, tr.started_at
        FROM tenant_rentals tr
        LEFT JOIN tenants t ON t.id = tr.tenant_id
        LEFT JOIN properties p ON p.id = tr.property_id
        WHERE LOWER(t.wallet_address) = LOWER(%s)
        ORDER BY tr.started_at DESC
        LIMIT 8
        """,
        (wallet,),
    )
    payments = _fetch_rows(
        db,
        """
        SELECT rp.id, rp.property_id, p.name AS property_name, rp.amount,
               rp.payment_status, rp.payment_date, rp.rent_year, rp.rent_month
        FROM rent_payments rp
        LEFT JOIN tenants t ON t.id = rp.tenant_id
        LEFT JOIN properties p ON p.id = rp.property_id
        WHERE LOWER(t.wallet_address) = LOWER(%s)
        ORDER BY rp.payment_date DESC NULLS LAST
        LIMIT 10
        """,
        (wallet,),
    )
    return {
        "rentals": [
            _row_summary(r, ["id", "property_id", "property_name", "monthly_rent_eth", "status", "started_at"])
            for r in rentals
        ],
        "recent_payments": [
            _row_summary(r, ["id", "property_id", "property_name", "amount", "payment_status",
                             "payment_date", "rent_year", "rent_month"])
            for r in payments
        ],
    }


def build_role_context(db: Any, role: str, wallet: str) -> dict[str, Any]:
    role = (role or "").strip().lower()
    if role == "investor":
        return {"role": "investor", **_investor_context(db, wallet)}
    if role == "property_owner":
        return {"role": "property_owner", **_property_owner_context(db, wallet)}
    if role == "tenant":
        return {"role": "tenant", **_tenant_context(db, wallet)}
    return {"role": role or "guest"}


_SYSTEM_PROMPT = (
    "You are EstateChain, a friendly Jarvis-style voice assistant for a Web3 real estate "
    "platform. The user is on the {role} dashboard. Respond conversationally, concisely "
    "(1–3 sentences for short questions, max 5 for analytics). Sound natural when read aloud — "
    "no markdown, no lists with bullets, no emojis. Refer to amounts in ETH when relevant. "
    "If the user greets you (hi/hello), greet back warmly and offer to help with their dashboard. "
    "Ground every fact in the JSON snapshot below; if the data isn't there, say so plainly and "
    "suggest a concrete next action. For analytics or risk questions, derive insights from the "
    "snapshot — compare investments, highlight payment trends, flag obvious concentration or "
    "concerns. Never fabricate transaction hashes, addresses, or amounts."
)


def _truncate(json_text: str, limit: int) -> str:
    if len(json_text) <= limit:
        return json_text
    return json_text[: limit - 12] + "...truncated"


async def generate_conversational_reply(
    *,
    db: Any,
    role: str,
    wallet: str,
    user_message: str,
) -> str | None:
    """Returns a conversational reply or None when no LLM is configured."""
    settings = get_ai_settings()
    if not settings.ai_llm_synthesis_enabled:
        return None
    router = get_completion_router()
    if not router.any_configured():
        return None

    context = build_role_context(db, role, wallet)
    snapshot_json = _truncate(
        json.dumps(context, default=str, separators=(",", ":")),
        settings.max_facts_json_chars,
    )
    system_prompt = _SYSTEM_PROMPT.format(role=role or "user")
    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "system",
            "content": f"USER_DATA_SNAPSHOT_JSON:\n{snapshot_json}",
        },
        {"role": "user", "content": user_message or ""},
    ]
    result = await router.complete_with_failover(
        messages=messages,
        max_tokens=min(settings.max_llm_output_tokens, 320),
        temperature=0.5,
        json_mode=False,
    )
    text = (result.text or "").strip()
    if not text or result.error:
        return None
    return text
