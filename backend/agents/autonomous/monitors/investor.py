"""Investor autonomous monitoring — yields, rewards, concentration (advisory)."""
from __future__ import annotations

import hashlib
import json
from datetime import date
from decimal import Decimal
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
        platform_role="investor",
        trace_id=new_trace_id(),
        dashboard_surface="autonomous_agent",
        extras={"_agent_db": db},
    )


async def collect_events(cur, *, uid: int, wallet: str, db: Any, role: str) -> list[dict[str, Any]]:
    if canonical_role(role) != "investor":
        return []
    reg = get_tool_registry()
    ctx = _ctx(uid, wallet, db)
    out: list[dict[str, Any]] = []
    day = date.today().isoformat()

    port = await reg.invoke("investor.portfolio", ctx, {"refresh": False}, db=db)
    if port.ok:
        data = port.data or {}
        div = data.get("diversification") or {}
        try:
            largest = Decimal(str(div.get("largest_position_weight") or "0"))
        except Exception:
            largest = Decimal(0)
        if largest >= Decimal("0.72") and int(div.get("property_count") or 0) >= 2:
            out.append(
                {
                    "user_id": uid,
                    "platform_role": "investor",
                    "agent": "investor.portfolio_concentration",
                    "severity": "warning",
                    "category": "risk",
                    "title": "Portfolio concentration elevated",
                    "body": (
                        "Deterministic diversification metrics show a dominant single-property weight. "
                        "Review allocation in the marketplace — no automated rebalance is performed."
                    ),
                    "metadata": {"largest_position_weight": str(largest), "property_count": div.get("property_count")},
                    "draft_payload": {
                        "kind": "orchestration_draft",
                        "hint": "Open Investor Copilot to compare holdings and low-risk cohort analytics.",
                    },
                    "dedupe_key": f"inv:concentration:{uid}:{day}",
                }
            )

    claim = await reg.invoke("investor.claimable_rewards", ctx, {}, db=db)
    if claim.ok:
        res = (claim.data or {}).get("result") or {}
        props = res.get("properties") or []
        total_wei = 0
        top_pid = None
        for p in props:
            try:
                w = int(str(p.get("claimable_amount_wei") or "0"))
            except ValueError:
                w = 0
            total_wei += w
            if w > 0 and top_pid is None:
                top_pid = int(p.get("property_id") or 0) or None
        if total_wei > 0:
            out.append(
                {
                    "user_id": uid,
                    "platform_role": "investor",
                    "agent": "investor.rewards_opportunity",
                    "severity": "opportunity",
                    "category": "rewards",
                    "title": "Claimable rewards available",
                    "body": (
                        "Indexed rewards indicate a non-zero claimable balance. "
                        "Review rewards in-app; signing still requires MetaMask approval."
                    ),
                    "metadata": {"total_claimable_wei": str(total_wei), "sample_property_id": top_pid},
                    "draft_payload": {
                        "kind": "orchestration_draft",
                        "suggested_next_step": "tx.prepare_claim_rewards",
                        "property_id_hint": top_pid,
                        "non_custodial": True,
                    },
                    "dedupe_key": f"inv:rewards:{uid}:{day}",
                }
            )

    top = await reg.invoke("marketplace.top_yielding_properties", ctx, {"limit": 6}, db=db)
    if top.ok:
        ranked = (top.data or {}).get("ranked") or []
        digest_src = json.dumps(ranked[:3], default=str, sort_keys=True)[:512]
        prev = ast_store.get_kv_text(cur, user_id=uid, namespace="autonomous", key="investor:top_yield_digest")
        if prev is None:
            ast_store.set_kv_text(cur, user_id=uid, namespace="autonomous", key="investor:top_yield_digest", value=digest_src)
        elif prev != digest_src and ranked:
            lead = ranked[0] if isinstance(ranked[0], dict) else {}
            pid = int(lead.get("property_id") or 0) or None
            h = hashlib.sha256(digest_src.encode()).hexdigest()[:32]
            out.append(
                {
                    "user_id": uid,
                    "platform_role": "investor",
                    "agent": "investor.market_yield_shift",
                    "severity": "info",
                    "category": "yield",
                    "title": "Marketplace yield ranking updated",
                    "body": (
                        "Top-yield proxy ordering changed versus the last autonomous snapshot. "
                        "This is informational — validate on-chain rent and sale economics before acting."
                    ),
                    "metadata": {"leading_property_id": pid},
                    "draft_payload": None,
                    "dedupe_key": f"inv:yield_rank:{uid}:{h}",
                }
            )
            ast_store.set_kv_text(cur, user_id=uid, namespace="autonomous", key="investor:top_yield_digest", value=digest_src)

    return out
