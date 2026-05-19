"""Tool registry exposed to the LLM.

Each tool is a small, role-gated function that:
* reads real data via the existing services / DB (single source of truth),
* and/or returns ``AgentAction`` objects the frontend should execute.

The LLM never executes any side effects directly — every workflow ends in the
existing MetaMask + modal pipeline, so we keep the same security model the
dashboards already enforce.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Awaitable, Callable

from backend.ai.schemas import AgentAction, ToolResult
from backend.api._helpers import enrich_property_with_supply, fetch_property, format_transaction_row, lock_property
from backend.services.auth import AuthUser, canonical_role, normalize_address

LOGGER = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tool metadata + dispatch
# ---------------------------------------------------------------------------

ToolHandler = Callable[[dict, AuthUser, Any], Awaitable[ToolResult]]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict
    roles: frozenset[str]
    handler: ToolHandler


_REGISTRY: dict[str, ToolSpec] = {}


def register(spec: ToolSpec) -> None:
    _REGISTRY[spec.name] = spec


def tools_for_role(role: str) -> list[ToolSpec]:
    """Return only the tools available to ``role``.

    Universal tools (``roles == ALL_ROLES``) are visible to every persona; the
    rest are gated so each agent persona only sees its own surface area.
    """
    r = canonical_role(role)
    return [t for t in _REGISTRY.values() if (not t.roles) or r in t.roles]


def openai_tool_schemas(role: str) -> list[dict]:
    """Return the OpenAI ``tools=[...]`` list filtered by role."""
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            },
        }
        for t in tools_for_role(role)
    ]


async def dispatch(name: str, arguments: dict, user: AuthUser, db: Any) -> ToolResult:
    spec = _REGISTRY.get(name)
    if not spec:
        return ToolResult(ok=False, error=f"Unknown tool: {name}")
    role = canonical_role(user.role)
    if spec.roles and role not in spec.roles:
        return ToolResult(ok=False, error=f"Tool '{name}' is not available for role '{role}'.")
    try:
        return await spec.handler(arguments or {}, user, db)
    except Exception as exc:  # noqa: BLE001 - tools must never crash the agent loop
        return ToolResult(ok=False, error=str(exc)[:300])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ALL_ROLES = frozenset({"property_owner", "investor", "tenant"})


def _eth(amount_wei: str | int | None, digits: int = 4) -> str:
    if amount_wei in (None, "", "0"):
        return "0"
    try:
        wei = int(str(amount_wei))
    except (TypeError, ValueError):
        return "0"
    return f"{Decimal(wei) / Decimal(10**18):.{digits}f}"


def _serialize_property(row: dict) -> dict:
    return {
        "id": int(row["id"]),
        "name": row.get("name"),
        "location": row.get("location"),
        "token_symbol": row.get("token_symbol"),
        "total_value": str(row.get("total_value") or "0"),
        "token_supply": str(row.get("token_supply") or "0"),
        "tokens_sold": str(row.get("tokens_sold") or "0"),
        "tokens_available": str(row.get("tokens_available") or "0"),
        "sold_percentage": str(row.get("sold_percentage") or "0"),
        "monthly_rent_eth": row.get("monthly_rent_eth"),
        "monthly_rent_wei": str(row.get("monthly_rent_wei") or "0"),
        "rent_enabled": str(row.get("monthly_rent_wei") or "0") not in ("", "0"),
        "owner_wallet": row.get("owner_wallet"),
        "token_address": row.get("token_address"),
    }


def _list_properties(cursor) -> list[dict]:
    cursor.execute(
        "SELECT * FROM properties WHERE COALESCE(is_active, TRUE) = TRUE ORDER BY id DESC"
    )
    rows = cursor.fetchall() or []
    return [_serialize_property(enrich_property_with_supply(cursor, r)) for r in rows]


# ---------------------------------------------------------------------------
# Read tools — all roles
# ---------------------------------------------------------------------------


async def _get_my_profile(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    return ToolResult(
        ok=True,
        data={
            "wallet_address": user.wallet_address,
            "role": canonical_role(user.role),
            "email": user.email,
            "kyc_status": user.kyc_status,
        },
    )


register(ToolSpec(
    name="get_my_profile",
    description="Return the current signed-in user's wallet, role, and KYC status.",
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=ALL_ROLES,
    handler=_get_my_profile,
))


async def _list_properties_tool(args: dict, _user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        items = _list_properties(cursor)
    finally:
        cursor.close()
    q = (args.get("search") or "").strip().lower()
    if q:
        items = [
            p for p in items
            if q in (p["name"] or "").lower() or q in (p["location"] or "").lower()
        ]
    rent_only = bool(args.get("rent_enabled_only"))
    if rent_only:
        items = [p for p in items if p["rent_enabled"]]
    return ToolResult(ok=True, data={"count": len(items), "properties": items[:25]})


register(ToolSpec(
    name="list_properties",
    description=(
        "List all active properties on the platform. Each property includes its "
        "monthly rent (when set), token sale progress, and whether rent is "
        "currently enabled."
    ),
    parameters={
        "type": "object",
        "properties": {
            "search": {"type": "string", "description": "Optional case-insensitive search on name or location."},
            "rent_enabled_only": {"type": "boolean", "description": "When true, only return properties where the owner has set monthly rent."},
        },
        "additionalProperties": False,
    },
    roles=ALL_ROLES,
    handler=_list_properties_tool,
))


# ---------------------------------------------------------------------------
# Investor tools
# ---------------------------------------------------------------------------


async def _get_my_portfolio(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT p.id AS property_id, p.name AS property_name, p.location,
                   p.token_symbol, p.token_supply,
                   o.token_amount AS token_amount_base
            FROM token_ownerships o
            JOIN properties p ON p.id = o.property_id
            JOIN users u ON u.id = o.user_id
            WHERE LOWER(u.wallet_address) = LOWER(%s) AND o.token_amount > 0
            ORDER BY p.id DESC
            """,
            (user.wallet_address,),
        )
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    holdings = []
    for r in rows:
        base = int(r.get("token_amount_base") or 0)
        supply = int(r.get("token_supply") or 0)
        # Tokens are 18-decimal ERC-20 — display in whole tokens.
        whole = base // (10 ** 18) if base else 0
        total_supply_whole = supply // (10 ** 18) if supply else 0
        pct = round((whole / total_supply_whole) * 100, 2) if total_supply_whole else 0
        holdings.append({
            "property_id": r["property_id"],
            "property_name": r["property_name"],
            "location": r["location"],
            "token_symbol": r["token_symbol"],
            "token_amount": whole,
            "total_supply": total_supply_whole,
            "ownership_percentage": pct,
        })
    return ToolResult(ok=True, data={"count": len(holdings), "holdings": holdings})


register(ToolSpec(
    name="get_my_portfolio",
    description="Return the signed-in investor's token holdings across every property they own tokens of.",
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"investor"}),
    handler=_get_my_portfolio,
))


async def _get_my_claimable_rewards(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT property_id,
                   SUM(CAST(payout_amount_wei AS DECIMAL(36,0))) AS pending_wei,
                   COUNT(*) AS pending_payouts
            FROM investor_rent_payouts
            WHERE LOWER(investor_wallet) = LOWER(%s)
              AND COALESCE(claim_status, 'claimable') = 'claimable'
            GROUP BY property_id
            ORDER BY pending_wei DESC
            """,
            (user.wallet_address,),
        )
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    items = [
        {
            "property_id": int(r["property_id"]),
            "claimable_eth": _eth(int(r["pending_wei"] or 0)),
            "pending_payouts": int(r["pending_payouts"] or 0),
        }
        for r in rows
    ]
    total_eth = _eth(sum(int(r["pending_wei"] or 0) for r in rows))
    return ToolResult(ok=True, data={"total_claimable_eth": total_eth, "properties": items})


register(ToolSpec(
    name="get_my_claimable_rewards",
    description="Return the signed-in investor's claimable rent rewards, grouped by property.",
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"investor"}),
    handler=_get_my_claimable_rewards,
))


# ---------------------------------------------------------------------------
# Tenant tools
# ---------------------------------------------------------------------------


async def _get_my_active_rentals(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT tr.id, tr.property_id, p.name AS property_name, p.location,
                   tr.rental_start_date, tr.status
            FROM tenant_rentals tr
            JOIN tenants t ON t.id = tr.tenant_id
            JOIN properties p ON p.id = tr.property_id
            WHERE LOWER(t.wallet_address) = LOWER(%s) AND tr.status = 'active'
            ORDER BY tr.created_at DESC
            """,
            (user.wallet_address,),
        )
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    rentals = [
        {
            "id": int(r["id"]),
            "property_id": int(r["property_id"]),
            "property_name": r["property_name"],
            "location": r["location"],
            "rental_start_date": r["rental_start_date"].isoformat() if r.get("rental_start_date") else None,
            "status": r["status"],
        }
        for r in rows
    ]
    return ToolResult(ok=True, data={"count": len(rentals), "rentals": rentals})


register(ToolSpec(
    name="get_my_active_rentals",
    description=(
        "Return rentals the tenant has paid rent on at least once (the "
        "tenant_rentals table). NOTE: this does NOT cover properties the "
        "tenant could pay rent on for the first time — for that use "
        "list_properties with rent_enabled_only=true."
    ),
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"tenant"}),
    handler=_get_my_active_rentals,
))


async def _get_my_rent_payments(args: dict, user: AuthUser, db: Any) -> ToolResult:
    limit = int(args.get("limit") or 10)
    limit = max(1, min(limit, 50))
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT rp.id, rp.amount_eth, rp.tx_hash, rp.payment_date,
                   rp.payment_status, p.name AS property_name, rp.property_id
            FROM rent_payments rp
            JOIN tenants t ON t.id = rp.tenant_id
            JOIN properties p ON p.id = rp.property_id
            WHERE LOWER(t.wallet_address) = LOWER(%s)
            ORDER BY rp.payment_date DESC
            LIMIT %s
            """,
            (user.wallet_address, limit),
        )
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    payments = [
        {
            "id": int(r["id"]),
            "property_id": int(r["property_id"]),
            "property_name": r["property_name"],
            "amount_eth": str(r["amount_eth"] or "0"),
            "tx_hash": r["tx_hash"],
            "payment_date": r["payment_date"].isoformat() if r.get("payment_date") else None,
            "payment_status": r["payment_status"],
        }
        for r in rows
    ]
    return ToolResult(ok=True, data={"count": len(payments), "payments": payments})


register(ToolSpec(
    name="get_my_rent_payments",
    description="Return the signed-in tenant's most recent rent payments (default 10, max 50).",
    parameters={
        "type": "object",
        "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 50}},
        "additionalProperties": False,
    },
    roles=frozenset({"tenant"}),
    handler=_get_my_rent_payments,
))


# ---------------------------------------------------------------------------
# Property-owner tools
# ---------------------------------------------------------------------------


async def _get_my_owned_properties(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT * FROM properties WHERE LOWER(owner_wallet) = LOWER(%s) "
            "AND COALESCE(is_active, TRUE) = TRUE ORDER BY id DESC",
            (user.wallet_address,),
        )
        rows = cursor.fetchall() or []
        items = [_serialize_property(enrich_property_with_supply(cursor, r)) for r in rows]
    finally:
        cursor.close()
    return ToolResult(ok=True, data={"count": len(items), "properties": items})


register(ToolSpec(
    name="get_my_owned_properties",
    description="Return all properties owned by the signed-in property owner.",
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"property_owner"}),
    handler=_get_my_owned_properties,
))


async def _get_rent_analytics(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT
              COALESCE(SUM(CAST(rp.amount_wei AS DECIMAL(36,0))), 0) AS collected_wei,
              COUNT(*) AS payments_count
            FROM rent_payments rp
            JOIN properties p ON p.id = rp.property_id
            WHERE LOWER(p.owner_wallet) = LOWER(%s)
            """,
            (user.wallet_address,),
        )
        agg = cursor.fetchone() or {}
        cursor.execute(
            "SELECT COUNT(*) AS active FROM tenant_rentals tr "
            "JOIN properties p ON p.id = tr.property_id "
            "WHERE LOWER(p.owner_wallet) = LOWER(%s) AND tr.status = 'active'",
            (user.wallet_address,),
        )
        active = cursor.fetchone() or {}
    finally:
        cursor.close()
    return ToolResult(
        ok=True,
        data={
            "total_rent_collected_eth": _eth(int(agg.get("collected_wei") or 0)),
            "payments_count": int(agg.get("payments_count") or 0),
            "active_rentals": int(active.get("active") or 0),
        },
    )


register(ToolSpec(
    name="get_rent_analytics",
    description="Aggregate rent metrics across the signed-in property owner's portfolio.",
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"property_owner"}),
    handler=_get_rent_analytics,
))


async def _get_my_investors(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT u.wallet_address, u.email,
                   p.id AS property_id, p.name AS property_name, p.token_symbol,
                   p.token_supply, o.token_amount AS token_amount_base
            FROM token_ownerships o
            JOIN users u ON u.id = o.user_id
            JOIN properties p ON p.id = o.property_id
            WHERE LOWER(p.owner_wallet) = LOWER(%s) AND o.token_amount > 0
            ORDER BY p.id DESC, o.token_amount DESC
            """,
            (user.wallet_address,),
        )
        rows = cursor.fetchall() or []
    finally:
        cursor.close()

    by_property: dict[int, dict] = {}
    for r in rows:
        pid = int(r["property_id"])
        base = int(r.get("token_amount_base") or 0)
        supply = int(r.get("token_supply") or 0)
        whole = base // (10 ** 18) if base else 0
        total_whole = supply // (10 ** 18) if supply else 0
        pct = round((whole / total_whole) * 100, 2) if total_whole else 0
        bucket = by_property.setdefault(pid, {
            "property_id": pid,
            "property_name": r["property_name"],
            "token_symbol": r["token_symbol"],
            "investors": [],
        })
        bucket["investors"].append({
            "wallet_address": r["wallet_address"],
            "email": r.get("email"),
            "token_amount": whole,
            "ownership_percentage": pct,
        })

    properties = list(by_property.values())
    total_investors = sum(len(p["investors"]) for p in properties)
    return ToolResult(
        ok=True,
        data={
            "total_investors": total_investors,
            "properties": properties,
        },
    )


register(ToolSpec(
    name="get_my_investors",
    description=(
        "List investors holding tokens of any property owned by the signed-in "
        "property owner, grouped by property."
    ),
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"property_owner"}),
    handler=_get_my_investors,
))


# ---------------------------------------------------------------------------
# Extended read tools — full read access to every dashboard page
# ---------------------------------------------------------------------------


async def _get_wallet_balance(_args: dict, user: AuthUser, _db: Any) -> ToolResult:
    """Return native ETH balance + property-token balances for the signed-in user."""
    from backend.services.blockchain import (
        from_base_units,
        get_contract,
        get_erc20_balance,
        get_native_balance,
        get_web3,
    )
    from backend.config.settings import TOKEN_DECIMALS

    web3 = get_web3()
    wallet = user.wallet_address
    if not wallet or not web3.is_address(wallet):
        return ToolResult(ok=False, error="No wallet connected.")
    checksum = web3.to_checksum_address(wallet)
    native_wei = int(get_native_balance(checksum))
    native_eth = str(web3.from_wei(native_wei, "ether"))

    tokens: list[dict] = []
    db = _db
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT id, name, token_address, token_symbol "
            "FROM properties WHERE token_address IS NOT NULL"
        )
        for row in cursor.fetchall() or []:
            addr = row.get("token_address")
            if not addr:
                continue
            try:
                contract = get_contract("SecurityToken", addr)
                base = int(get_erc20_balance(contract, checksum))
            except Exception as exc:  # noqa: BLE001
                LOGGER.warning("token balance failed property=%s err=%s", row.get("id"), exc)
                continue
            if base <= 0:
                continue
            tokens.append({
                "property_id": int(row["id"]),
                "property_name": row.get("name"),
                "symbol": row.get("token_symbol"),
                "balance": str(from_base_units(base, TOKEN_DECIMALS)),
            })
    finally:
        cursor.close()
    return ToolResult(
        ok=True,
        data={
            "wallet_address": checksum,
            "eth_balance": native_eth,
            "eth_balance_wei": str(native_wei),
            "property_tokens": tokens,
        },
    )


register(ToolSpec(
    name="get_wallet_balance",
    description=(
        "Return the signed-in user's wallet balances: native ETH and every "
        "property token they hold. Use for questions about wallet balance, "
        "ETH balance, or 'how much ETH do I have'."
    ),
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=ALL_ROLES,
    handler=_get_wallet_balance,
))


def _format_transaction(row: dict) -> dict:
    formatted = format_transaction_row(dict(row))
    ts = formatted.get("timestamp")
    if hasattr(ts, "isoformat"):
        formatted["timestamp"] = ts.isoformat()
    return {
        "id": int(formatted.get("id") or 0),
        "tx_hash": formatted.get("tx_hash"),
        "type": formatted.get("type"),
        "action_label": formatted.get("action_label"),
        "description": formatted.get("description"),
        "display_amount": str(formatted.get("display_amount") or "0"),
        "amount_unit": formatted.get("amount_unit"),
        "property_id": formatted.get("property_id"),
        "property_name": formatted.get("property_name"),
        "wallet_address": formatted.get("wallet_address"),
        "timestamp": formatted.get("timestamp"),
        "amount_spent": formatted.get("amount_spent"),
        "gas_fee": formatted.get("gas_fee"),
    }


async def _get_my_transactions(args: dict, user: AuthUser, db: Any) -> ToolResult:
    limit = max(1, min(int(args.get("limit") or 10), 50))
    tx_type = (args.get("type") or "").strip() or None
    cursor = db.cursor(dictionary=True)
    try:
        conditions = ["LOWER(COALESCE(t.wallet_address, i.investor_wallet)) = LOWER(%s)"]
        params: list = [user.wallet_address]
        if tx_type:
            conditions.append("t.type = %s")
            params.append(tx_type)
        query = (
            "SELECT t.id, t.tx_hash, t.type, t.amount, t.timestamp, t.property_id, "
            "t.block_number, COALESCE(t.wallet_address, i.investor_wallet) AS wallet_address, "
            "t.gas_fee, t.amount_spent, t.remaining_balance, p.name AS property_name "
            "FROM transactions t "
            "LEFT JOIN properties p ON p.id = t.property_id "
            "LEFT JOIN investments i ON LOWER(i.deposit_tx_hash) = LOWER(t.tx_hash) "
            "WHERE " + " AND ".join(conditions) + " "
            "ORDER BY t.timestamp DESC, t.id DESC LIMIT %s"
        )
        params.append(limit)
        cursor.execute(query, tuple(params))
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    txs = [_format_transaction(r) for r in rows]
    return ToolResult(ok=True, data={"count": len(txs), "transactions": txs})


register(ToolSpec(
    name="get_my_transactions",
    description=(
        "Recent on-chain transactions involving the signed-in user (invest, "
        "rent paid, claims, transfers). Use for questions like 'show my last "
        "transaction', 'my last 2 transactions', 'recent activity'."
    ),
    parameters={
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Default 10."},
            "type": {"type": "string", "description": "Optional filter: ISSUE_TOKENS, INVESTMENT_FUNDED, RENT_PAID, REWARDS_CLAIMED, RENT_DISTRIBUTED, TRANSFER, MINT_NFT."},
        },
        "additionalProperties": False,
    },
    roles=ALL_ROLES,
    handler=_get_my_transactions,
))


async def _get_all_transactions(args: dict, _user: AuthUser, db: Any) -> ToolResult:
    limit = max(1, min(int(args.get("limit") or 20), 100))
    tx_type = (args.get("type") or "").strip() or None
    property_id = args.get("property_id")
    cursor = db.cursor(dictionary=True)
    try:
        conditions: list[str] = []
        params: list = []
        if tx_type:
            conditions.append("t.type = %s")
            params.append(tx_type)
        if property_id is not None:
            conditions.append("t.property_id = %s")
            params.append(int(property_id))
        query = (
            "SELECT t.id, t.tx_hash, t.type, t.amount, t.timestamp, t.property_id, "
            "t.block_number, COALESCE(t.wallet_address, i.investor_wallet) AS wallet_address, "
            "t.gas_fee, t.amount_spent, t.remaining_balance, p.name AS property_name "
            "FROM transactions t "
            "LEFT JOIN properties p ON p.id = t.property_id "
            "LEFT JOIN investments i ON LOWER(i.deposit_tx_hash) = LOWER(t.tx_hash) "
        )
        if conditions:
            query += "WHERE " + " AND ".join(conditions) + " "
        query += "ORDER BY t.timestamp DESC, t.id DESC LIMIT %s"
        params.append(limit)
        cursor.execute(query, tuple(params))
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    txs = [_format_transaction(r) for r in rows]
    return ToolResult(ok=True, data={"count": len(txs), "transactions": txs})


register(ToolSpec(
    name="get_all_transactions",
    description=(
        "Platform-wide on-chain transactions across every property. Use for "
        "property-owner analytics like 'last transactions on the platform', "
        "'all transactions for Azure View', or 'recent rent payments'."
    ),
    parameters={
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "description": "Default 20."},
            "type": {"type": "string", "description": "Optional transaction type filter."},
            "property_id": {"type": "integer", "description": "Optional property id filter."},
        },
        "additionalProperties": False,
    },
    roles=ALL_ROLES,
    handler=_get_all_transactions,
))


async def _get_property_details(args: dict, _user: AuthUser, db: Any) -> ToolResult:
    pid = args.get("property_id")
    if pid is None:
        return ToolResult(ok=False, error="property_id is required.")
    cursor = db.cursor(dictionary=True)
    try:
        prop = fetch_property(cursor, int(pid))
        if not prop:
            return ToolResult(ok=False, error=f"Property {pid} not found.")
        enriched = enrich_property_with_supply(cursor, prop)
        cursor.execute(
            "SELECT COUNT(DISTINCT user_id) AS investor_count "
            "FROM token_ownerships WHERE property_id = %s AND token_amount > 0",
            (int(pid),),
        )
        investor_count = int((cursor.fetchone() or {}).get("investor_count") or 0)
        cursor.execute(
            "SELECT COUNT(*) AS active FROM tenant_rentals WHERE property_id = %s AND status = 'active'",
            (int(pid),),
        )
        active = int((cursor.fetchone() or {}).get("active") or 0)
    finally:
        cursor.close()
    base = _serialize_property(enriched)
    base["investor_count"] = investor_count
    base["active_rentals"] = active
    return ToolResult(ok=True, data=base)


register(ToolSpec(
    name="get_property_details",
    description=(
        "Return detailed info on a single property — sale progress, monthly "
        "rent, investor count, active rentals. Resolve the id from "
        "list_properties first if you only have a name."
    ),
    parameters={
        "type": "object",
        "properties": {
            "property_id": {"type": "integer", "description": "Property id."},
        },
        "required": ["property_id"],
        "additionalProperties": False,
    },
    roles=ALL_ROLES,
    handler=_get_property_details,
))


async def _get_my_rent_distributions(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT rd.id, rd.property_id, p.name AS property_name, "
            "rd.total_distributed, rd.investor_count, rd.distributed_at, rd.tx_hash "
            "FROM rent_distributions rd "
            "JOIN properties p ON p.id = rd.property_id "
            "WHERE LOWER(p.owner_wallet) = LOWER(%s) "
            "ORDER BY rd.distributed_at DESC LIMIT 50",
            (user.wallet_address,),
        )
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    items = [
        {
            "property_id": int(r["property_id"]),
            "property_name": r.get("property_name"),
            "total_distributed_eth": _eth(int(r.get("total_distributed") or 0)),
            "investor_count": int(r.get("investor_count") or 0),
            "distributed_at": r["distributed_at"].isoformat() if r.get("distributed_at") else None,
            "tx_hash": r.get("tx_hash"),
        }
        for r in rows
    ]
    return ToolResult(ok=True, data={"count": len(items), "distributions": items})


register(ToolSpec(
    name="get_my_rent_distributions",
    description=(
        "Rent distributions sent out across properties owned by the signed-in "
        "property owner. Each row is one distribution event with total ETH and "
        "investor count."
    ),
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"property_owner"}),
    handler=_get_my_rent_distributions,
))


async def _get_my_active_tenants(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT tr.id, tr.property_id, p.name AS property_name, p.location, "
            "t.wallet_address AS tenant_wallet, tr.rental_start_date, tr.status "
            "FROM tenant_rentals tr "
            "JOIN tenants t ON t.id = tr.tenant_id "
            "JOIN properties p ON p.id = tr.property_id "
            "WHERE LOWER(p.owner_wallet) = LOWER(%s) AND tr.status = 'active' "
            "ORDER BY tr.created_at DESC",
            (user.wallet_address,),
        )
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    items = [
        {
            "property_id": int(r["property_id"]),
            "property_name": r.get("property_name"),
            "location": r.get("location"),
            "tenant_wallet": r.get("tenant_wallet"),
            "rental_start_date": r["rental_start_date"].isoformat() if r.get("rental_start_date") else None,
        }
        for r in rows
    ]
    return ToolResult(ok=True, data={"count": len(items), "rentals": items})


register(ToolSpec(
    name="get_my_active_tenants",
    description=(
        "Active tenant rentals across properties owned by the signed-in "
        "property owner. Use when the owner asks about their tenants."
    ),
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"property_owner"}),
    handler=_get_my_active_tenants,
))


async def _get_my_rent_collections(args: dict, user: AuthUser, db: Any) -> ToolResult:
    """Rent payments received across the owner's properties."""
    limit = max(1, min(int(args.get("limit") or 20), 100))
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT rp.id, rp.property_id, p.name AS property_name, rp.amount_eth, "
            "rp.amount_wei, rp.tx_hash, rp.payment_date, rp.payment_status, "
            "t.wallet_address AS tenant_wallet "
            "FROM rent_payments rp "
            "JOIN tenants t ON t.id = rp.tenant_id "
            "JOIN properties p ON p.id = rp.property_id "
            "WHERE LOWER(p.owner_wallet) = LOWER(%s) "
            "ORDER BY rp.payment_date DESC LIMIT %s",
            (user.wallet_address, limit),
        )
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    items = [
        {
            "property_id": int(r["property_id"]),
            "property_name": r.get("property_name"),
            "tenant_wallet": r.get("tenant_wallet"),
            "amount_eth": str(r.get("amount_eth") or "0"),
            "tx_hash": r.get("tx_hash"),
            "payment_date": r["payment_date"].isoformat() if r.get("payment_date") else None,
            "payment_status": r.get("payment_status"),
        }
        for r in rows
    ]
    return ToolResult(ok=True, data={"count": len(items), "payments": items})


register(ToolSpec(
    name="get_my_rent_collections",
    description=(
        "Rent payments collected by the signed-in property owner, across all "
        "their properties. Use for 'show recent rent received' or 'last rent "
        "payment'."
    ),
    parameters={
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "description": "Default 20."},
        },
        "additionalProperties": False,
    },
    roles=frozenset({"property_owner"}),
    handler=_get_my_rent_collections,
))


async def _get_my_yield_summary(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT COALESCE(SUM(CAST(payout_amount_wei AS DECIMAL(36,0))), 0) AS earned, "
            "COUNT(*) AS payouts, COUNT(DISTINCT property_id) AS props "
            "FROM investor_rent_payouts WHERE LOWER(investor_wallet) = LOWER(%s)",
            (user.wallet_address,),
        )
        totals = cursor.fetchone() or {}
        cursor.execute(
            "SELECT COALESCE(SUM(CAST(payout_amount_wei AS DECIMAL(36,0))), 0) AS claimable "
            "FROM investor_rent_payouts WHERE LOWER(investor_wallet) = LOWER(%s) "
            "AND COALESCE(claim_status, 'claimable') = 'claimable'",
            (user.wallet_address,),
        )
        claimable = int((cursor.fetchone() or {}).get("claimable") or 0)
        cursor.execute(
            "SELECT COALESCE(SUM(CAST(payout_amount_wei AS DECIMAL(36,0))), 0) AS claimed "
            "FROM investor_rent_payouts WHERE LOWER(investor_wallet) = LOWER(%s) "
            "AND claim_status = 'claimed'",
            (user.wallet_address,),
        )
        claimed = int((cursor.fetchone() or {}).get("claimed") or 0)
    finally:
        cursor.close()
    return ToolResult(
        ok=True,
        data={
            "total_earned_eth": _eth(int(totals.get("earned") or 0)),
            "total_claimable_eth": _eth(claimable),
            "total_claimed_eth": _eth(claimed),
            "total_payouts": int(totals.get("payouts") or 0),
            "properties_earning": int(totals.get("props") or 0),
        },
    )


register(ToolSpec(
    name="get_my_yield_summary",
    description=(
        "Cumulative yield summary for the signed-in investor: total earned, "
        "claimable, and already-claimed rent (in ETH)."
    ),
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"investor"}),
    handler=_get_my_yield_summary,
))


async def _get_my_claim_history(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT irp.property_id, p.name AS property_name, irp.claim_tx_hash, "
            "COALESCE(SUM(CAST(irp.payout_amount_wei AS DECIMAL(36,0))), 0) AS claimed_wei, "
            "COUNT(*) AS payout_count, MAX(irp.claimed_at) AS claimed_at "
            "FROM investor_rent_payouts irp "
            "JOIN properties p ON p.id = irp.property_id "
            "WHERE LOWER(irp.investor_wallet) = LOWER(%s) "
            "AND irp.claim_status = 'claimed' AND irp.claim_tx_hash IS NOT NULL "
            "GROUP BY irp.property_id, p.name, irp.claim_tx_hash "
            "ORDER BY MAX(irp.claimed_at) DESC LIMIT 50",
            (user.wallet_address,),
        )
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    items = [
        {
            "property_id": int(r["property_id"]),
            "property_name": r.get("property_name"),
            "claimed_amount_eth": _eth(int(r.get("claimed_wei") or 0)),
            "payout_count": int(r.get("payout_count") or 0),
            "claim_tx_hash": r.get("claim_tx_hash"),
            "claimed_at": r["claimed_at"].isoformat() if r.get("claimed_at") else None,
        }
        for r in rows
    ]
    return ToolResult(ok=True, data={"count": len(items), "claims": items})


register(ToolSpec(
    name="get_my_claim_history",
    description="Past reward claims by the signed-in investor, grouped by claim transaction.",
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"investor"}),
    handler=_get_my_claim_history,
))


async def _get_my_rental_earnings(_args: dict, user: AuthUser, db: Any) -> ToolResult:
    """Per-property breakdown of rent earnings for the signed-in user."""
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            "SELECT irp.property_id, p.name AS property_name, "
            "SUM(CAST(irp.payout_amount_wei AS DECIMAL(36,0))) AS earned_wei, "
            "COUNT(*) AS payment_count, "
            "MAX(irp.ownership_percentage) AS current_ownership_pct, "
            "MAX(irp.distributed_at) AS last_distributed_at "
            "FROM investor_rent_payouts irp "
            "JOIN properties p ON p.id = irp.property_id "
            "WHERE LOWER(irp.investor_wallet) = LOWER(%s) "
            "GROUP BY irp.property_id, p.name "
            "ORDER BY earned_wei DESC",
            (user.wallet_address,),
        )
        rows = cursor.fetchall() or []
    finally:
        cursor.close()
    items = [
        {
            "property_id": int(r["property_id"]),
            "property_name": r.get("property_name"),
            "earned_eth": _eth(int(r.get("earned_wei") or 0)),
            "payment_count": int(r.get("payment_count") or 0),
            "current_ownership_pct": float(r.get("current_ownership_pct") or 0),
            "last_distributed_at": r["last_distributed_at"].isoformat() if r.get("last_distributed_at") else None,
        }
        for r in rows
    ]
    return ToolResult(ok=True, data={"count": len(items), "earnings": items})


register(ToolSpec(
    name="get_my_rental_earnings",
    description=(
        "Per-property rent earnings breakdown for the signed-in investor — "
        "total earned, payment count, current ownership percentage."
    ),
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"investor"}),
    handler=_get_my_rental_earnings,
))


async def _get_platform_stats(_args: dict, _user: AuthUser, db: Any) -> ToolResult:
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute("SELECT COUNT(*) AS n FROM properties WHERE COALESCE(is_active, TRUE) = TRUE")
        properties_active = int((cursor.fetchone() or {}).get("n") or 0)
        cursor.execute("SELECT COUNT(DISTINCT user_id) AS n FROM token_ownerships WHERE token_amount > 0")
        investors_active = int((cursor.fetchone() or {}).get("n") or 0)
        cursor.execute("SELECT COUNT(*) AS n FROM tenant_rentals WHERE status = 'active'")
        active_rentals = int((cursor.fetchone() or {}).get("n") or 0)
        cursor.execute(
            "SELECT COALESCE(SUM(CAST(amount_wei AS DECIMAL(36,0))), 0) AS wei, COUNT(*) AS n "
            "FROM rent_payments"
        )
        rent_agg = cursor.fetchone() or {}
        cursor.execute(
            "SELECT COALESCE(SUM(CAST(total_distributed AS DECIMAL(36,0))), 0) AS wei "
            "FROM rent_distributions"
        )
        dist_agg = cursor.fetchone() or {}
        cursor.execute("SELECT COUNT(*) AS n FROM transactions")
        tx_count = int((cursor.fetchone() or {}).get("n") or 0)
    finally:
        cursor.close()
    return ToolResult(
        ok=True,
        data={
            "active_properties": properties_active,
            "active_investors": investors_active,
            "active_rentals": active_rentals,
            "total_rent_collected_eth": _eth(int(rent_agg.get("wei") or 0)),
            "rent_payments_count": int(rent_agg.get("n") or 0),
            "total_rent_distributed_eth": _eth(int(dist_agg.get("wei") or 0)),
            "total_transactions": tx_count,
        },
    )


register(ToolSpec(
    name="get_platform_stats",
    description=(
        "System-wide totals: active property count, active investors, active "
        "rentals, total rent collected/distributed, total transactions. Use "
        "for any 'how big is the platform' style question."
    ),
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=ALL_ROLES,
    handler=_get_platform_stats,
))


# ---------------------------------------------------------------------------
# Workflow tools — return UI actions the frontend executes
# ---------------------------------------------------------------------------


_CREATE_PROPERTY_FIELDS = (
    "name",
    "location",
    "total_value",
    "token_supply",
    "token_symbol",
    "monthly_rent_eth",
)


async def _start_create_property(_args: dict, _user: AuthUser, _db: Any) -> ToolResult:
    return ToolResult(
        ok=True,
        data={"message": "Opening the create property form."},
        actions=[
            AgentAction(type="NAVIGATE", route="/property_owner/properties"),
            AgentAction(type="OPEN_MODAL", modal="CREATE_PROPERTY"),
            AgentAction(type="FOCUS_FIELD", modal="CREATE_PROPERTY", field="name"),
        ],
    )


register(ToolSpec(
    name="start_create_property",
    description=(
        "Open the create-property workflow for the property owner. The frontend "
        "navigates to the properties page and opens the create-property modal "
        "with the first field focused. Use this once, at the start of the flow. "
        "After this call, ask the user for the property name and use "
        "fill_create_property to write each answer into the form."
    ),
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"property_owner"}),
    handler=_start_create_property,
))


async def _fill_create_property(args: dict, _user: AuthUser, _db: Any) -> ToolResult:
    import logging
    LOGGER = logging.getLogger(__name__)
    LOGGER.warning("[fill_create_property] Called with args: %s", args)
    actions: list[AgentAction] = []
    filled: dict[str, str] = {}
    for field in _CREATE_PROPERTY_FIELDS:
        value = args.get(field)
        if value is None or value == "":
            continue
        actions.append(AgentAction(
            type="FILL_FIELD",
            modal="CREATE_PROPERTY",
            field=field,
            value=str(value),
        ))
        filled[field] = str(value)

    missing = [f for f in _CREATE_PROPERTY_FIELDS[:5] if f not in filled]  # First 5 are required

    if args.get("submit"):
        LOGGER.warning("[fill_create_property] Adding SUBMIT_FORM action")
        if missing:
            LOGGER.warning("[fill_create_property] Cannot submit - missing required fields: %s", missing)
            return ToolResult(
                ok=False,
                error=f"Cannot submit. Missing required fields: {', '.join(missing)}. Please fill all fields before submitting.",
                data={"filled": filled, "missing": missing},
                actions=actions,  # Still fill what we have
            )
        actions.append(AgentAction(type="SUBMIT_FORM", modal="CREATE_PROPERTY"))
    else:
        LOGGER.warning("[fill_create_property] NO submit flag - collected so far: %s", list(filled.keys()))

    LOGGER.warning("[fill_create_property] Returning %d actions: %s", len(actions), actions)
    return ToolResult(
        ok=True,
        data={"filled": filled, "submitted": bool(args.get("submit")), "missing": missing},
        actions=actions,
    )


register(ToolSpec(
    name="fill_create_property",
    description=(
        "MANDATORY: Call this tool EVERY time the user provides a property field, "
        "and AGAIN on the final turn with ALL 5 fields + submit=true. "
        "Accumulate fields: 1st call name='X', 2nd call name='X',location='Y', etc. "
        "FINAL call MUST be: fill_create_property(name,location,total_value,token_supply,token_symbol,submit=true). "
        "YOU MUST CALL THIS TOOL. Saying 'Creating' without calling this tool does NOTHING."
    ),
    parameters={
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Property display name, e.g. 'Oceanview Apartments'."},
            "location": {"type": "string", "description": "City / location string."},
            "total_value": {"type": "string", "description": "Total property value in ETH, e.g. '10' or '12.5'."},
            "token_supply": {"type": "string", "description": "Total number of ownership tokens to mint, e.g. '10000'."},
            "token_symbol": {"type": "string", "description": "Short ticker for the token, e.g. 'OCEAN'."},
            "monthly_rent_eth": {"type": "string", "description": "Optional monthly rent in ETH."},
            "submit": {"type": "boolean", "description": "REQUIRED on the final call: set to true to submit the form and create the property. Without this, nothing is saved."},
        },
        "additionalProperties": False,
    },
    roles=frozenset({"property_owner"}),
    handler=_fill_create_property,
))


_ACTIVITY_QUERIES = (
    "SELECT 1 FROM token_ownerships WHERE property_id = %s AND token_amount > 0 LIMIT 1",
    "SELECT 1 FROM investments WHERE property_id = %s LIMIT 1",
    "SELECT 1 FROM transactions WHERE property_id = %s LIMIT 1",
    "SELECT 1 FROM rent_payments WHERE property_id = %s LIMIT 1",
    "SELECT 1 FROM rent_distributions WHERE property_id = %s LIMIT 1",
    "SELECT 1 FROM investor_rent_payouts WHERE property_id = %s LIMIT 1",
)


def _property_has_activity(cursor, prop: dict) -> bool:
    if prop.get("token_address") or prop.get("nft_token_id"):
        return True
    pid = int(prop["id"])
    for q in _ACTIVITY_QUERIES:
        cursor.execute(q, (pid,))
        if cursor.fetchone():
            return True
    return False


async def _delete_property(args: dict, user: AuthUser, db: Any) -> ToolResult:
    pid = args.get("property_id")
    if not pid:
        return ToolResult(ok=False, error="property_id is required.")
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return ToolResult(ok=False, error="property_id must be an integer.")

    cursor = db.cursor(dictionary=True)
    try:
        prop = lock_property(cursor, pid)
        if not prop:
            return ToolResult(ok=False, error=f"Property {pid} not found.")
        owner = normalize_address(prop.get("owner_wallet") or "")
        if not owner or owner != normalize_address(user.wallet_address):
            return ToolResult(ok=False, error="You can only delete properties you own.")

        name = prop.get("name") or f"Property {pid}"
        if _property_has_activity(cursor, prop):
            cursor.execute("UPDATE properties SET is_active = FALSE WHERE id = %s", (pid,))
            mode = "archived"
        else:
            cursor.execute("DELETE FROM properties WHERE id = %s", (pid,))
            mode = "deleted"
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        return ToolResult(ok=False, error=str(exc)[:300])
    finally:
        cursor.close()

    return ToolResult(
        ok=True,
        data={"property_id": pid, "name": name, "mode": mode},
        actions=[AgentAction(type="NAVIGATE", route="/property_owner/properties")],
    )


register(ToolSpec(
    name="delete_property",
    description=(
        "Delete or archive a property the signed-in property owner owns. If the "
        "property has any on-chain or rental activity it is archived "
        "(is_active=false); otherwise it is hard-deleted. The action navigates "
        "to /property_owner/properties so the list refreshes. Resolve the "
        "property by name via get_my_owned_properties first if you don't "
        "already have its id."
    ),
    parameters={
        "type": "object",
        "properties": {
            "property_id": {"type": "integer", "description": "ID of the property to remove."},
        },
        "required": ["property_id"],
        "additionalProperties": False,
    },
    roles=frozenset({"property_owner"}),
    handler=_delete_property,
))


async def _start_invest(args: dict, _user: AuthUser, db: Any) -> ToolResult:
    pid = args.get("property_id")
    token_amount = args.get("token_amount")
    if not pid:
        return ToolResult(ok=False, error="property_id is required.")
    cursor = db.cursor(dictionary=True)
    try:
        prop = fetch_property(cursor, int(pid))
        if not prop:
            return ToolResult(ok=False, error=f"Property {pid} not found.")
    finally:
        cursor.close()
    actions: list[AgentAction] = [
        AgentAction(type="NAVIGATE", route="/investor/marketplace"),
        AgentAction(type="OPEN_MODAL", modal="INVEST_PROPERTY", property_id=int(pid)),
    ]
    if token_amount is not None:
        actions.append(AgentAction(
            type="FILL_FIELD",
            modal="INVEST_PROPERTY",
            field="token_amount",
            value=str(int(token_amount)),
            property_id=int(pid),
        ))
        # Auto-trigger the MetaMask flow — the user only confirms in their wallet.
        actions.append(AgentAction(
            type="SUBMIT_FORM",
            modal="INVEST_PROPERTY",
            property_id=int(pid),
        ))
    return ToolResult(
        ok=True,
        data={"message": f"Opening invest dialog for {prop['name']}.", "property_id": int(pid)},
        actions=actions,
    )


register(ToolSpec(
    name="start_invest",
    description=(
        "Open the invest workflow on a specific property. Optionally prefill the "
        "token amount the user wants to buy. The user still confirms the "
        "transaction in MetaMask."
    ),
    parameters={
        "type": "object",
        "properties": {
            "property_id": {"type": "integer", "description": "ID of the property to invest in."},
            "token_amount": {"type": "integer", "minimum": 1, "description": "Number of whole tokens to purchase."},
        },
        "required": ["property_id"],
        "additionalProperties": False,
    },
    roles=frozenset({"investor"}),
    handler=_start_invest,
))


async def _start_pay_rent(args: dict, _user: AuthUser, db: Any) -> ToolResult:
    pid = args.get("property_id")
    if not pid:
        return ToolResult(ok=False, error="property_id is required.")
    cursor = db.cursor(dictionary=True)
    try:
        prop = fetch_property(cursor, int(pid))
        if not prop:
            return ToolResult(ok=False, error=f"Property {pid} not found.")
        if not (prop.get("monthly_rent_wei") and str(prop["monthly_rent_wei"]) != "0"):
            return ToolResult(
                ok=False,
                error="Rent has not been set on this property yet — ask the owner to set it first.",
            )
    finally:
        cursor.close()
    return ToolResult(
        ok=True,
        data={"message": f"Opening rent payment for {prop['name']}.", "property_id": int(pid)},
        actions=[
            AgentAction(type="NAVIGATE", route="/tenant/rentals"),
            AgentAction(type="OPEN_MODAL", modal="PAY_RENT", property_id=int(pid)),
            # Auto-trigger the MetaMask transaction — the user only confirms in their wallet.
            AgentAction(type="SUBMIT_FORM", modal="PAY_RENT", property_id=int(pid)),
        ],
    )


register(ToolSpec(
    name="start_pay_rent",
    description="Open the pay-rent workflow on a specific property. The user confirms the transaction in MetaMask.",
    parameters={
        "type": "object",
        "properties": {
            "property_id": {"type": "integer", "description": "ID of the property to pay rent on."},
        },
        "required": ["property_id"],
        "additionalProperties": False,
    },
    roles=frozenset({"tenant"}),
    handler=_start_pay_rent,
))


async def _start_claim_rewards(args: dict, _user: AuthUser, db: Any) -> ToolResult:
    pid = args.get("property_id")
    if not pid:
        return ToolResult(ok=False, error="property_id is required.")
    cursor = db.cursor(dictionary=True)
    try:
        prop = fetch_property(cursor, int(pid))
        if not prop:
            return ToolResult(ok=False, error=f"Property {pid} not found.")
    finally:
        cursor.close()
    return ToolResult(
        ok=True,
        data={"message": f"Opening rewards claim for {prop['name']}.", "property_id": int(pid)},
        actions=[
            AgentAction(type="NAVIGATE", route="/investor/yield"),
            AgentAction(type="OPEN_MODAL", modal="CLAIM_REWARDS", property_id=int(pid)),
            # Auto-trigger the MetaMask transaction — the user only confirms in their wallet.
            AgentAction(type="SUBMIT_FORM", modal="CLAIM_REWARDS", property_id=int(pid)),
        ],
    )


register(ToolSpec(
    name="start_claim_rewards",
    description="Open the claim-rewards workflow for a specific property the investor holds tokens of.",
    parameters={
        "type": "object",
        "properties": {
            "property_id": {"type": "integer", "description": "ID of the property to claim rewards from."},
        },
        "required": ["property_id"],
        "additionalProperties": False,
    },
    roles=frozenset({"investor"}),
    handler=_start_claim_rewards,
))


async def _navigate(args: dict, _user: AuthUser, _db: Any) -> ToolResult:
    route = (args.get("route") or "").strip()
    if not route or not route.startswith("/"):
        return ToolResult(ok=False, error="route must start with '/'.")
    return ToolResult(
        ok=True,
        data={"message": f"Navigating to {route}."},
        actions=[AgentAction(type="NAVIGATE", route=route)],
    )


register(ToolSpec(
    name="navigate",
    description=(
        "Navigate the user to a specific in-app page (e.g. /investor/portfolio, "
        "/tenant/payments). Use this only when the user explicitly asks to go "
        "to a page that no other tool covers."
    ),
    parameters={
        "type": "object",
        "properties": {"route": {"type": "string", "description": "Path starting with '/'."}},
        "required": ["route"],
        "additionalProperties": False,
    },
    roles=ALL_ROLES,
    handler=_navigate,
))
