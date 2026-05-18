"""Tool registry exposed to the LLM.

Each tool is a small, role-gated function that:
* reads real data via the existing services / DB (single source of truth),
* and/or returns ``AgentAction`` objects the frontend should execute.

The LLM never executes any side effects directly — every workflow ends in the
existing MetaMask + modal pipeline, so we keep the same security model the
dashboards already enforce.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Awaitable, Callable

from backend.ai.schemas import AgentAction, ToolResult
from backend.api._helpers import enrich_property_with_supply, fetch_property
from backend.services.auth import AuthUser, canonical_role


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
    r = (role or "").lower()
    return [t for t in _REGISTRY.values() if not t.roles or r in t.roles]


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
    description="Return the investor's current token holdings across all properties.",
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
    description="Return the investor's claimable rent rewards, grouped by property.",
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
    description="Return the tenant's currently active rentals.",
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
    description="Return the tenant's most recent rent payments (default 10, max 50).",
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
    description="Return all properties owned by the current property owner.",
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
    description="Aggregate rent metrics across all properties owned by the current property owner.",
    parameters={"type": "object", "properties": {}, "additionalProperties": False},
    roles=frozenset({"property_owner"}),
    handler=_get_rent_analytics,
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
    actions: list[AgentAction] = []
    filled: list[str] = []
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
        filled.append(field)
    if args.get("submit"):
        actions.append(AgentAction(type="SUBMIT_FORM", modal="CREATE_PROPERTY"))
    return ToolResult(
        ok=True,
        data={"filled": filled, "submitted": bool(args.get("submit"))},
        actions=actions,
    )


register(ToolSpec(
    name="fill_create_property",
    description=(
        "Fill one or more fields in the create-property form that "
        "start_create_property opened. Pass each field as the user provides it. "
        "Set submit=true on the final call (after all required fields are "
        "filled) to submit the form. Required fields are name, location, "
        "total_value, token_supply, token_symbol. monthly_rent_eth is optional."
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
            "submit": {"type": "boolean", "description": "Set to true once all required fields are filled to submit the form."},
        },
        "additionalProperties": False,
    },
    roles=frozenset({"property_owner"}),
    handler=_fill_create_property,
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
