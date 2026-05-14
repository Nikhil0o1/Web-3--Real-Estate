"""Property-owner autonomous monitoring — operational drift (advisory)."""
from __future__ import annotations

import json
from datetime import date
from typing import Any

from backend.agents.autonomous import store as ast_store
from backend.agents.context.session import OrchestrationContext
from backend.agents.observability.logging import new_trace_id
from backend.agents.tools.registry import get_tool_registry
from backend.services.auth import canonical_role


def _ctx(uid: int, wallet: str, db) -> OrchestrationContext:
    return OrchestrationContext(
        user_id=int(uid),
        wallet_address=str(wallet),
        platform_role="property_owner",
        trace_id=new_trace_id(),
        dashboard_surface="autonomous_agent",
        extras={"_agent_db": db},
    )


async def collect_events(cur, *, uid: int, wallet: str, db: Any, role: str) -> list[dict[str, Any]]:
    if canonical_role(role) != "property_owner":
        return []
    reg = get_tool_registry()
    ctx = _ctx(uid, wallet, db)
    out: list[dict[str, Any]] = []
    day = date.today().isoformat()

    ops = await reg.invoke("owner.get_property_operational_metrics", ctx, {}, db=db)
    if not ops.ok:
        return out
    rows = (ops.data or {}).get("properties") or []
    digest = json.dumps(rows, default=str, sort_keys=True)[:900]
    prev = ast_store.get_kv_text(cur, user_id=uid, namespace="autonomous", key="owner:ops_digest")
    if prev is None:
        ast_store.set_kv_text(cur, user_id=uid, namespace="autonomous", key="owner:ops_digest", value=digest)
        return out
    under = await reg.invoke("owner.detect_underperforming_properties", ctx, {}, db=db)
    under_list = []
    if under.ok:
        under_list = (under.data or {}).get("underperforming") or []
    if prev != digest and under_list:
        out.append(
            {
                "user_id": uid,
                "platform_role": "property_owner",
                "agent": "owner.operational_shift",
                "severity": "warning",
                "category": "operations",
                "title": "Operational metrics changed with underperformance flags",
                "body": (
                    "Deterministic operational metrics differ from the prior autonomous snapshot while "
                    "underperforming properties are flagged. Review analytics — no rent or pricing changes are applied automatically."
                ),
                "metadata": {"underperforming_count": len(under_list)},
                "draft_payload": {
                    "kind": "orchestration_draft",
                    "hint": "Open Property Intelligence Copilot for revenue and occupancy narratives.",
                },
                "dedupe_key": f"own:ops_shift:{uid}:{day}",
            }
        )
    ast_store.set_kv_text(cur, user_id=uid, namespace="autonomous", key="owner:ops_digest", value=digest)
    return out
