"""Persistence for autonomous intelligence (watchlists + events)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from psycopg2.extras import Json


@dataclass(frozen=True)
class IntelligenceEventRow:
    id: int
    agent: str
    severity: str
    category: str
    title: str
    body: str
    metadata: dict[str, Any]
    draft_payload: dict[str, Any] | None
    read_at: Any
    created_at: Any


def insert_intelligence_event(
    cur,
    *,
    user_id: int,
    platform_role: str,
    agent: str,
    severity: str,
    category: str,
    title: str,
    body: str,
    metadata: dict[str, Any],
    draft_payload: dict[str, Any] | None,
    dedupe_key: str,
) -> int | None:
    """Insert if dedupe_key is new. Returns new id or None if duplicate."""
    dk = dedupe_key[:200]
    cur.execute(
        """
        INSERT INTO ai_intelligence_events (
            user_id, platform_role, agent, severity, category, title, body,
            metadata_json, draft_payload_json, dedupe_key
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (user_id, dedupe_key) DO NOTHING
        RETURNING id
        """,
        (
            int(user_id),
            platform_role[:32],
            agent[:96],
            severity[:24],
            category[:64],
            title[:255],
            body,
            Json(metadata or {}),
            Json(draft_payload) if draft_payload is not None else None,
            dk,
        ),
    )
    row = cur.fetchone()
    if not row:
        return None
    return int(row[0])


def list_intelligence_events(cur, *, user_id: int, limit: int = 50) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT id, agent, severity, category, title, body, metadata_json, draft_payload_json, read_at, created_at
        FROM ai_intelligence_events
        WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (int(user_id), int(limit)),
    )
    rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "id": int(r["id"]),
                "agent": r["agent"],
                "severity": r["severity"],
                "category": r["category"],
                "title": r["title"],
                "body": r["body"],
                "metadata": r["metadata_json"] if isinstance(r["metadata_json"], dict) else {},
                "draft_payload": r["draft_payload_json"] if isinstance(r["draft_payload_json"], dict) else None,
                "read_at": r["read_at"].isoformat() if r.get("read_at") else None,
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
                "unread": r.get("read_at") is None,
            }
        )
    return out


def mark_event_read(cur, *, user_id: int, event_id: int) -> bool:
    cur.execute(
        """
        UPDATE ai_intelligence_events
        SET read_at = CURRENT_TIMESTAMP
        WHERE id = %s AND user_id = %s AND read_at IS NULL
        """,
        (int(event_id), int(user_id)),
    )
    return cur.rowcount > 0


def count_unread(cur, *, user_id: int) -> int:
    cur.execute(
        "SELECT COUNT(*) AS c FROM ai_intelligence_events WHERE user_id = %s AND read_at IS NULL",
        (int(user_id),),
    )
    row = cur.fetchone() or {}
    return int(row.get("c", 0) or 0)


def get_kv_text(cur, *, user_id: int, namespace: str, key: str) -> str | None:
    cur.execute(
        "SELECT value FROM agent_context_kv WHERE user_id = %s AND namespace = %s AND key = %s",
        (int(user_id), namespace[:64], key[:128]),
    )
    row = cur.fetchone()
    if not row:
        return None
    return str(row[0])


def set_kv_text(cur, *, user_id: int, namespace: str, key: str, value: str) -> None:
    cur.execute(
        """
        INSERT INTO agent_context_kv (user_id, namespace, key, value, updated_at)
        VALUES (%s,%s,%s,%s,CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, namespace, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
        """,
        (int(user_id), namespace[:64], key[:128], value),
    )


def list_watchlists(cur, *, user_id: int) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT id, platform_role, name, rules_json, active, created_at, updated_at
        FROM ai_watchlists WHERE user_id = %s ORDER BY updated_at DESC
        """,
        (int(user_id),),
    )
    rows = cur.fetchall() or []
    out = []
    for r in rows:
        rules = r["rules_json"]
        if isinstance(rules, str):
            try:
                rules = json.loads(rules)
            except json.JSONDecodeError:
                rules = {}
        out.append(
            {
                "id": int(r["id"]),
                "platform_role": r["platform_role"],
                "name": r["name"],
                "rules": rules if isinstance(rules, dict) else {},
                "active": bool(r["active"]),
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
                "updated_at": r["updated_at"].isoformat() if r.get("updated_at") else None,
            }
        )
    return out


def create_watchlist(cur, *, user_id: int, platform_role: str, name: str, rules: dict[str, Any]) -> int:
    cur.execute(
        """
        INSERT INTO ai_watchlists (user_id, platform_role, name, rules_json, active)
        VALUES (%s,%s,%s,%s,TRUE)
        RETURNING id
        """,
        (int(user_id), platform_role[:32], name[:160], Json(rules or {})),
    )
    return int(cur.fetchone()[0])


def delete_watchlist(cur, *, user_id: int, watchlist_id: int) -> bool:
    cur.execute("DELETE FROM ai_watchlists WHERE id = %s AND user_id = %s", (int(watchlist_id), int(user_id)))
    return cur.rowcount > 0
