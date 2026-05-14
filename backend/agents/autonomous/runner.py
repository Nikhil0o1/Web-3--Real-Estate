"""Single-tick autonomous monitoring — invokes existing tool registry (read-only)."""
from __future__ import annotations

from typing import Any

from backend.agents.autonomous import store as ast_store
from backend.agents.autonomous.governance import MAX_USERS_PER_TICK, TickBudget
from backend.agents.autonomous.monitors import investor as inv_mon
from backend.agents.autonomous.monitors import property_owner as po_mon
from backend.agents.autonomous.monitors import tenant as tn_mon
from backend.agents.governance.store import get_autonomous_agents_enabled, record_governance_event, record_metric_sample
from backend.agents.observability.logging import get_agent_logger
from backend.db.connection import get_connection
from backend.services.auth import canonical_role

_LOG = get_agent_logger("autonomous.runner")


async def run_autonomous_tick() -> dict[str, Any]:
    """Scan active users and persist deduplicated intelligence events."""
    if not get_autonomous_agents_enabled():
        try:
            record_metric_sample(
                metric_key="autonomous.tick",
                dimensions={"status": "disabled"},
                value={"users_scanned": 0, "events_inserted": 0},
            )
        except Exception:
            pass
        return {"users_scanned": 0, "events_inserted": 0, "disabled": True}

    conn = get_connection()
    cur = conn.cursor(dictionary=True)
    budget = TickBudget()
    inserted = 0
    scanned = 0
    try:
        cur.execute(
            """
            SELECT id, wallet_address, role
            FROM users
            WHERE active = TRUE
            ORDER BY COALESCE(last_login, created_at) DESC
            LIMIT %s
            """,
            (MAX_USERS_PER_TICK,),
        )
        users = cur.fetchall() or []
        scanned = len(users)
        for u in users:
            uid = int(u["id"])
            wallet = str(u["wallet_address"])
            role = canonical_role(str(u.get("role") or "investor"))
            events: list[dict[str, Any]] = []
            try:
                if role == "investor":
                    events.extend(await inv_mon.collect_events(cur, uid=uid, wallet=wallet, db=conn, role=role))
                elif role == "property_owner":
                    events.extend(await po_mon.collect_events(cur, uid=uid, wallet=wallet, db=conn, role=role))
                elif role == "tenant":
                    events.extend(await tn_mon.collect_events(cur, uid=uid, wallet=wallet, db=conn, role=role))
            except Exception as exc:  # noqa: BLE001
                _LOG.warning("autonomous_user_failed user_id=%s role=%s err=%s", uid, role, exc)
                continue
            for e in events:
                if not budget.allow(e["user_id"]):
                    break
                new_id = ast_store.insert_intelligence_event(
                    cur,
                    user_id=int(e["user_id"]),
                    platform_role=str(e["platform_role"]),
                    agent=str(e["agent"]),
                    severity=str(e["severity"]),
                    category=str(e["category"]),
                    title=str(e["title"]),
                    body=str(e["body"]),
                    metadata=e.get("metadata") or {},
                    draft_payload=e.get("draft_payload"),
                    dedupe_key=str(e["dedupe_key"]),
                )
                if new_id:
                    budget.consume(e["user_id"])
                    inserted += 1
        conn.commit()
        try:
            record_metric_sample(
                metric_key="autonomous.tick",
                dimensions={"status": "ok"},
                value={"users_scanned": scanned, "events_inserted": inserted},
            )
            record_governance_event(
                event_type="autonomous.tick.summary",
                severity="info",
                source="autonomous_runner",
                payload={"users_scanned": scanned, "events_inserted": inserted},
            )
        except Exception:
            pass
    except Exception:
        conn.rollback()
        _LOG.exception("autonomous_tick_failed")
        raise
    finally:
        cur.close()
        conn.close()
    return {"users_scanned": scanned, "events_inserted": inserted}
