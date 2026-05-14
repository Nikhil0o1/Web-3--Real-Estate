"""Governance persistence — settings, metric samples, unified events (Phase 8)."""
from __future__ import annotations

import json
import logging
from typing import Any

from backend.db.connection import get_connection

_LOG = logging.getLogger(__name__)


def record_governance_event(
    *,
    event_type: str,
    severity: str = "info",
    user_id: int | None = None,
    actor_user_id: int | None = None,
    trace_id: str | None = None,
    source: str = "platform",
    payload: dict[str, Any] | None = None,
) -> None:
    """Best-effort append to governance timeline (never raises to callers)."""
    db = None
    cur = None
    try:
        db = get_connection()
        cur = db.cursor()
        cur.execute(
            """
            INSERT INTO governance_events (
                event_type, severity, user_id, actor_user_id, trace_id, source, payload_json
            ) VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb)
            """,
            (
                event_type[:96],
                severity[:24],
                user_id,
                actor_user_id,
                trace_id,
                source[:64],
                json.dumps(payload or {}, separators=(",", ":")),
            ),
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        if db:
            db.rollback()
        _LOG.warning("governance_event_persist_failed type=%s err=%s", event_type, exc)
    finally:
        try:
            if cur:
                cur.close()
        finally:
            if db:
                db.close()


def record_metric_sample(
    *,
    metric_key: str,
    dimensions: dict[str, Any] | None = None,
    value: dict[str, Any] | None = None,
) -> None:
    db = None
    cur = None
    try:
        db = get_connection()
        cur = db.cursor()
        cur.execute(
            """
            INSERT INTO governance_metric_samples (metric_key, dimensions_json, value_json)
            VALUES (%s,%s::jsonb,%s::jsonb)
            """,
            (
                metric_key[:160],
                json.dumps(dimensions or {}, separators=(",", ":")),
                json.dumps(value or {}, separators=(",", ":")),
            ),
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        if db:
            db.rollback()
        _LOG.warning("governance_metric_persist_failed key=%s err=%s", metric_key, exc)
    finally:
        try:
            if cur:
                cur.close()
        finally:
            if db:
                db.close()


def get_setting(cur, key: str) -> dict[str, Any] | None:
    cur.execute(
        "SELECT value_json FROM governance_settings WHERE setting_key = %s",
        (key[:128],),
    )
    row = cur.fetchone()
    if not row:
        return None
    v = row[0] if not isinstance(row, dict) else row.get("value_json")
    if isinstance(v, dict):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return {}
    return {}


def upsert_setting(cur, *, key: str, value: dict[str, Any], actor_user_id: int | None) -> None:
    cur.execute(
        """
        INSERT INTO governance_settings (setting_key, value_json, updated_at, updated_by_user_id)
        VALUES (%s, %s::jsonb, CURRENT_TIMESTAMP, %s)
        ON CONFLICT (setting_key) DO UPDATE SET
            value_json = EXCLUDED.value_json,
            updated_at = CURRENT_TIMESTAMP,
            updated_by_user_id = EXCLUDED.updated_by_user_id
        """,
        (key[:128], json.dumps(value or {}, separators=(",", ":")), actor_user_id),
    )


def get_setting_bool(key: str, default: bool) -> bool:
    conn = get_connection()
    cur = conn.cursor()
    try:
        data = get_setting(cur, key)
        if data is None:
            return default
        v = data.get("enabled")
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() in ("1", "true", "yes", "on")
        return default
    finally:
        cur.close()
        conn.close()


def fetch_setting_json(key: str) -> dict[str, Any]:
    """Standalone read (new connection) for hot paths like provider routing."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        data = get_setting(cur, key)
        return dict(data or {})
    finally:
        cur.close()
        conn.close()


def get_autonomous_agents_enabled() -> bool:
    return get_setting_bool("autonomous_agents_enabled", True)


def get_autonomous_tick_seconds(default: float) -> float:
    raw = fetch_setting_json("autonomous_tick_interval_sec").get("seconds", default)
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return float(default)
    return max(30.0, min(3600.0, v))


def load_provider_routing_override() -> dict[str, str] | None:
    """Returns validated ``{"primary": "openai|anthropic", "fallback": ...}`` or ``None``."""
    data = fetch_setting_json("provider_routing")
    primary = str(data.get("primary") or "").strip().lower()
    fallback = str(data.get("fallback") or "").strip().lower()
    allowed = {"openai", "anthropic"}
    if primary not in allowed:
        return None
    if fallback and fallback not in allowed:
        fallback = ""
    if fallback == primary:
        fallback = ""
    return {"primary": primary, "fallback": fallback or ""}
