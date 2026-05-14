"""Phase 8 — institutional governance HTTP surface (property-owner admin scope)."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.agents.config.providers import invalidate_completion_router
from backend.agents.governance import queries as gq
from backend.agents.governance import risk_signals
from backend.agents.governance import summaries
from backend.agents.governance.store import record_governance_event, upsert_setting
from backend.api.deps import get_db, require_property_owner
from backend.config.settings import (
    AUTONOMOUS_QUEUE_DISPATCH,
    MEMORY_REDIS_CACHE,
    REDIS_URL,
    RUN_AUTONOMOUS_AGENTS_IN_WEB,
    RUN_INDEXER_IN_WEB,
    STREAM_BUFFER_MAX_EVENTS,
    STREAM_REDIS_BUFFER,
)
from backend.services.auth import AuthUser
from backend.infra.queues import autonomous_queue_dispatch_enabled, orchestration_stub_depth, queue_depths
from backend.infra.redis_client import redis_ping_ok

router = APIRouter(prefix="/governance", tags=["governance-console"])

_ALLOWED_KEYS = frozenset(
    {
        "autonomous_agents_enabled",
        "autonomous_tick_interval_sec",
        "provider_routing",
        "orchestration_budget_tokens_daily",
        "alert_thresholds",
        "governance_severity_escalation",
        "monitoring_intensity",
    }
)


class GovernanceSettingsPut(BaseModel):
    settings: dict[str, dict[str, Any]] = Field(default_factory=dict)


def _validate_setting(key: str, value: dict[str, Any]) -> dict[str, Any]:
    if key == "autonomous_agents_enabled":
        en = value.get("enabled")
        if not isinstance(en, bool):
            raise HTTPException(status_code=422, detail="autonomous_agents_enabled.enabled must be boolean")
        return {"enabled": en}
    if key == "autonomous_tick_interval_sec":
        raw = value.get("seconds")
        try:
            sec = int(raw)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="autonomous_tick_interval_sec.seconds must be int") from exc
        if sec < 30 or sec > 3600:
            raise HTTPException(status_code=422, detail="seconds must be between 30 and 3600")
        return {"seconds": sec}
    if key == "provider_routing":
        primary = str(value.get("primary") or "").strip().lower()
        fallback = str(value.get("fallback") or "").strip().lower()
        allowed = {"openai", "anthropic"}
        if primary not in allowed:
            raise HTTPException(status_code=422, detail="provider_routing.primary must be openai|anthropic")
        if fallback and fallback not in allowed:
            raise HTTPException(status_code=422, detail="provider_routing.fallback must be openai|anthropic or empty")
        return {"primary": primary, "fallback": fallback}
    if key == "orchestration_budget_tokens_daily":
        raw = value.get("max_tokens")
        try:
            n = int(raw)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=422, detail="orchestration_budget_tokens_daily.max_tokens int") from exc
        if n < 1000 or n > 50_000_000:
            raise HTTPException(status_code=422, detail="max_tokens out of range")
        return {"max_tokens": n}
    if key in ("alert_thresholds", "governance_severity_escalation", "monitoring_intensity"):
        if not isinstance(value, dict) or len(value) > 64:
            raise HTTPException(status_code=422, detail=f"{key} must be a small JSON object")
        return dict(value)
    raise HTTPException(status_code=400, detail="Unsupported setting key")


@router.get("/overview")
def governance_overview(_user: AuthUser = Depends(require_property_owner), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        return gq.fetch_overview(cur)
    finally:
        cur.close()


@router.get("/timeline")
def governance_timeline(limit: int = 120, _user: AuthUser = Depends(require_property_owner), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        return {"items": gq.fetch_timeline(cur, limit=limit)}
    finally:
        cur.close()


@router.get("/audit/runs")
def governance_audit_runs(
    limit: int = 40,
    offset: int = 0,
    user_id: int | None = None,
    wallet_address: str | None = None,
    _user: AuthUser = Depends(require_property_owner),
    db=Depends(get_db),
):
    cur = db.cursor(dictionary=True)
    try:
        return {
            "items": gq.fetch_audit_runs(
                cur, limit=limit, offset=offset, user_id=user_id, wallet_address=wallet_address
            )
        }
    finally:
        cur.close()


@router.get("/audit/runs/{run_id}")
def governance_audit_run_detail(run_id: int, _user: AuthUser = Depends(require_property_owner), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        detail = gq.fetch_audit_run_detail(cur, run_id=run_id)
        if not detail:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
        return detail
    finally:
        cur.close()


@router.get("/providers")
def governance_providers(_user: AuthUser = Depends(require_property_owner), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        ov = gq.fetch_overview(cur)
        return {"rollups": ov.get("provider_rollups_7d") or [], "runtime_env_hints": ov.get("runtime_env_hints") or {}}
    finally:
        cur.close()


@router.get("/risk-signals")
def governance_risk_signals(_user: AuthUser = Depends(require_property_owner), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        return {"signals": risk_signals.compute_risk_signals(cur)}
    finally:
        cur.close()


@router.get("/notifications")
def governance_notifications(_user: AuthUser = Depends(require_property_owner), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        return {"items": gq.fetch_governance_notifications(cur)}
    finally:
        cur.close()


@router.get("/admin-brief")
def governance_admin_brief(_user: AuthUser = Depends(require_property_owner), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        text = summaries.build_admin_brief(cur)
        return {"format": "markdown", "text": text}
    finally:
        cur.close()


@router.get("/settings")
def governance_settings_get(_user: AuthUser = Depends(require_property_owner), db=Depends(get_db)):
    cur = db.cursor(dictionary=True)
    try:
        stored = gq.fetch_all_settings(cur)
        return {"settings": stored}
    finally:
        cur.close()


@router.put("/settings")
def governance_settings_put(
    body: GovernanceSettingsPut,
    user: AuthUser = Depends(require_property_owner),
    db=Depends(get_db),
):
    if not body.settings:
        raise HTTPException(status_code=422, detail="No settings provided")
    cur = db.cursor(dictionary=True)
    try:
        touched_routing = False
        audit_pairs: list[tuple[str, dict[str, Any]]] = []
        for key, val in body.settings.items():
            if key not in _ALLOWED_KEYS:
                raise HTTPException(status_code=400, detail=f"Key not allowed: {key}")
            if not isinstance(val, dict):
                raise HTTPException(status_code=422, detail=f"Value for {key} must be object")
            cleaned = _validate_setting(key, val)
            upsert_setting(cur, key=key, value=cleaned, actor_user_id=int(user.id))
            audit_pairs.append((key, cleaned))
            if key == "provider_routing":
                touched_routing = True
        db.commit()
        for key, cleaned in audit_pairs:
            record_governance_event(
                event_type="governance.settings.updated",
                severity="info",
                actor_user_id=int(user.id),
                source="governance_api",
                payload={"setting_key": key, "value": cleaned},
            )
        if touched_routing:
            invalidate_completion_router()
        return {"ok": True}
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        cur.close()


@router.get("/observability/summary")
def governance_observability(_user: AuthUser = Depends(require_property_owner), db=Depends(get_db)):
    """Lightweight operational snapshot derived from persisted samples + audit tables."""
    cur = db.cursor(dictionary=True)
    try:
        ov = gq.fetch_overview(cur)
        cur.execute(
            """
            SELECT metric_key, COUNT(*)::int AS c
            FROM governance_metric_samples
            WHERE recorded_at >= NOW() - INTERVAL '24 hours'
            GROUP BY metric_key
            ORDER BY c DESC
            LIMIT 24
            """
        )
        keys = cur.fetchall() or []
        metric_keys = []
        for row in keys:
            if isinstance(row, dict):
                metric_keys.append({"metric_key": row.get("metric_key"), "samples_24h": int(row.get("c") or 0)})
        cur.execute(
            """
            SELECT
              SUM(CASE WHEN ok THEN 0 ELSE 1 END)::int AS err_steps,
              SUM(CASE WHEN ok THEN 1 ELSE 0 END)::int AS ok_steps,
              COUNT(*)::int AS total
            FROM agent_orchestration_steps s
            JOIN agent_orchestration_runs r ON r.id = s.run_id
            WHERE r.created_at >= NOW() - INTERVAL '24 hours'
            """
        )
        st = cur.fetchone() or {}
        return {
            "orchestration": {
                "runs_24h": ov.get("orchestration_runs_24h"),
                "ok_rate_24h": ov.get("orchestration_ok_rate_24h"),
                "stream_runs_24h": ov.get("orchestration_stream_runs_24h"),
                "avg_step_latency_ms_24h": ov.get("avg_tool_step_latency_ms_24h"),
                "steps_ok_24h": int(st.get("ok_steps") or 0) if isinstance(st, dict) else 0,
                "steps_error_24h": int(st.get("err_steps") or 0) if isinstance(st, dict) else 0,
            },
            "metrics": {"samples_by_key_24h": metric_keys},
            "intel_events_24h": ov.get("intel_events_24h"),
            "governance_events_24h": ov.get("governance_events_24h"),
        }
    finally:
        cur.close()


@router.get("/infra/status")
def governance_infra_status(_user: AuthUser = Depends(require_property_owner)):
    """Infra snapshot for ops (no secrets). Redis/queues are optional; single-process is the default."""
    if not REDIS_URL:
        return {
            "deployment_mode": "single_instance",
            "redis": "disabled",
            "queue_mode": "single_process",
            "queues": None,
            "flags": {
                "AUTONOMOUS_QUEUE_DISPATCH": False,
                "AUTONOMOUS_QUEUE_DISPATCH_env": AUTONOMOUS_QUEUE_DISPATCH,
                "RUN_AUTONOMOUS_AGENTS_IN_WEB": RUN_AUTONOMOUS_AGENTS_IN_WEB,
                "RUN_INDEXER_IN_WEB": RUN_INDEXER_IN_WEB,
                "STREAM_REDIS_BUFFER": STREAM_REDIS_BUFFER,
                "STREAM_BUFFER_MAX_EVENTS": STREAM_BUFFER_MAX_EVENTS,
                "MEMORY_REDIS_CACHE": MEMORY_REDIS_CACHE,
            },
            "note": "Redis not configured — orchestration runs in-process; set REDIS_URL for optional queue/buffer/cache.",
        }

    depths = queue_depths()
    q_mode = "distributed_redis" if autonomous_queue_dispatch_enabled() else "single_process"
    r_ok = redis_ping_ok()
    return {
        "deployment_mode": "single_instance" if q_mode == "single_process" else "optional_distributed",
        "redis": "ok" if r_ok else "unavailable",
        "queue_mode": q_mode,
        "queues": {
            **depths,
            "orchestration_stub_depth": orchestration_stub_depth(),
            "autonomous_dispatch_enabled": autonomous_queue_dispatch_enabled(),
        },
        "flags": {
            "AUTONOMOUS_QUEUE_DISPATCH": AUTONOMOUS_QUEUE_DISPATCH,
            "RUN_AUTONOMOUS_AGENTS_IN_WEB": RUN_AUTONOMOUS_AGENTS_IN_WEB,
            "RUN_INDEXER_IN_WEB": RUN_INDEXER_IN_WEB,
            "STREAM_REDIS_BUFFER": STREAM_REDIS_BUFFER,
            "STREAM_BUFFER_MAX_EVENTS": STREAM_BUFFER_MAX_EVENTS,
            "MEMORY_REDIS_CACHE": MEMORY_REDIS_CACHE,
        },
    }
