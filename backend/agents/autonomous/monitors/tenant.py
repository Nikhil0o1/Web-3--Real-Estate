"""Tenant autonomous monitoring — rent cadence + affordability signals (advisory)."""
from __future__ import annotations

from datetime import date
from typing import Any

from backend.agents.context.session import OrchestrationContext
from backend.agents.observability.logging import new_trace_id
from backend.agents.tools.registry import get_tool_registry
from backend.services.auth import canonical_role


def _ctx(uid: int, wallet: str, db) -> OrchestrationContext:
    return OrchestrationContext(
        user_id=int(uid),
        wallet_address=str(wallet),
        platform_role="tenant",
        trace_id=new_trace_id(),
        dashboard_surface="autonomous_agent",
        extras={"_agent_db": db},
    )


async def collect_events(cur, *, uid: int, wallet: str, db: Any, role: str) -> list[dict[str, Any]]:
    if canonical_role(role) != "tenant":
        return []
    reg = get_tool_registry()
    ctx = _ctx(uid, wallet, db)
    out: list[dict[str, Any]] = []
    day = date.today().isoformat()

    rem = await reg.invoke("tenant.next_payment_reminder", ctx, {}, db=db)
    if rem.ok:
        data = rem.data or {}
        msg = str(data.get("message") or "")
        obligation = str(data.get("monthly_obligation_wei") or "0")
        if "Upcoming" in msg or int(obligation or "0") > 0:
            out.append(
                {
                    "user_id": uid,
                    "platform_role": "tenant",
                    "agent": "tenant.rent_cadence",
                    "severity": "info",
                    "category": "rent",
                    "title": "Upcoming rent obligation signal",
                    "body": (
                        "Deterministic tenant analytics detected an active rent obligation window. "
                        "Confirm due dates in payments — payments still require your wallet approval."
                    ),
                    "metadata": {"monthly_obligation_wei": obligation},
                    "draft_payload": {
                        "kind": "orchestration_draft",
                        "hint": "Open Rental Intelligence Copilot or tenant payments to review history.",
                    },
                    "dedupe_key": f"ten:rent_cadence:{uid}:{day}",
                }
            )

    aff = await reg.invoke("tenant.calculate_affordability_metrics", ctx, {}, db=db)
    if aff.ok:
        health = str((aff.data or {}).get("affordability_health") or "")
        if health == "tight":
            out.append(
                {
                    "user_id": uid,
                    "platform_role": "tenant",
                    "agent": "tenant.affordability_tight",
                    "severity": "warning",
                    "category": "affordability",
                    "title": "Affordability buffer looks tight",
                    "body": (
                        "Wallet balance versus modeled monthly obligations suggests limited runway. "
                        "This is a deterministic heuristic — not financial advice."
                    ),
                    "metadata": {"affordability_health": health},
                    "draft_payload": None,
                    "dedupe_key": f"ten:afford:{uid}:{day}",
                }
            )

    return out
