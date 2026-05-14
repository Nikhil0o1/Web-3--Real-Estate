"""Read-side aggregations for governance console (property-owner / admin scope)."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from backend.agents.config.settings import get_ai_settings


def _iso(dt: Any) -> str | None:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


def fetch_overview(cur) -> dict[str, Any]:
    cur.execute(
        """
        SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_n
        FROM agent_orchestration_runs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        """
    )
    r24 = cur.fetchone() or {}
    runs_24h = int(r24.get("n") or 0)
    ok_runs = int(r24.get("ok_n") or 0)

    cur.execute(
        """
        SELECT AVG(s.duration_ms)::double precision AS avg_ms
        FROM agent_orchestration_steps s
        JOIN agent_orchestration_runs r ON r.id = s.run_id
        WHERE r.created_at >= NOW() - INTERVAL '24 hours' AND s.duration_ms IS NOT NULL
        """
    )
    row = cur.fetchone() or {}
    avg_step_ms = float(row.get("avg_ms") or 0.0)

    cur.execute(
        """
        SELECT COUNT(*) AS n
        FROM agent_orchestration_runs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND execution_mode::text LIKE '%_stream%'
        """
    )
    r_stream = cur.fetchone() or {}
    stream_runs_24h = int(r_stream.get("n") or 0)

    cur.execute(
        """
        SELECT severity, COUNT(*)::int AS c
        FROM governance_events
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY severity
        """
    )
    sev_rows = cur.fetchall() or []
    severity_counts: dict[str, int] = {}
    for sr in sev_rows:
        if isinstance(sr, dict):
            severity_counts[str(sr.get("severity") or "")] = int(sr.get("c") or 0)
        else:
            severity_counts[str(sr[0])] = int(sr[1] or 0)

    cur.execute(
        """
        SELECT COUNT(*)::int AS c FROM governance_events
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        """
    )
    ge = cur.fetchone() or {}
    gov_events_24h = int(ge.get("c") or 0)

    cur.execute(
        """
        SELECT COUNT(*)::int AS c FROM governance_metric_samples
        WHERE recorded_at >= NOW() - INTERVAL '24 hours'
        """
    )
    ms = cur.fetchone() or {}
    metric_samples_24h = int(ms.get("c") or 0)

    cur.execute(
        """
        SELECT COUNT(*)::int AS c FROM ai_intelligence_events
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        """
    )
    ai = cur.fetchone() or {}
    intel_events_24h = int(ai.get("c") or 0)

    cur.execute(
        """
        SELECT
          dimensions_json->>'provider' AS provider,
          COUNT(*)::int AS samples,
          SUM(CASE WHEN (value_json->>'fallback_used')::boolean THEN 1 ELSE 0 END)::int AS fallbacks,
          AVG((value_json->>'latency_ms')::double precision) AS avg_latency_ms,
          SUM(COALESCE((value_json->>'prompt_tokens')::bigint, (value_json->>'input_tokens')::bigint, 0)) AS prompt_tokens,
          SUM(COALESCE((value_json->>'completion_tokens')::bigint, (value_json->>'output_tokens')::bigint, 0)) AS completion_tokens
        FROM governance_metric_samples
        WHERE metric_key = 'llm.synthesis.complete'
          AND recorded_at >= NOW() - INTERVAL '7 days'
        GROUP BY 1
        """
    )
    prov_rows = cur.fetchall() or []
    provider_rollups: list[dict[str, Any]] = []
    for pr in prov_rows:
        if isinstance(pr, dict):
            p = pr.get("provider") or "unknown"
            samples = int(pr.get("samples") or 0)
            fallbacks = int(pr.get("fallbacks") or 0)
            avg_lat = float(pr.get("avg_latency_ms") or 0.0)
            pt = int(pr.get("prompt_tokens") or 0)
            ct = int(pr.get("completion_tokens") or 0)
        else:
            p, samples, fallbacks, avg_lat, pt, ct = pr[0], int(pr[1] or 0), int(pr[2] or 0), float(pr[3] or 0), int(pr[4] or 0), int(pr[5] or 0)
        fail_rate = (fallbacks / samples) if samples else 0.0
        est_cost = _rough_llm_cost_usd(str(p), pt, ct)
        provider_rollups.append(
            {
                "provider": p,
                "samples_7d": samples,
                "fallback_count_7d": fallbacks,
                "fallback_rate_7d": round(fail_rate, 4),
                "avg_latency_ms_7d": round(avg_lat, 2),
                "prompt_tokens_7d": pt,
                "completion_tokens_7d": ct,
                "estimated_cost_usd_7d": round(est_cost, 4),
            }
        )

    ai_s = get_ai_settings()
    return {
        "window_hours": 24,
        "orchestration_runs_24h": runs_24h,
        "orchestration_ok_runs_24h": ok_runs,
        "orchestration_ok_rate_24h": round((ok_runs / runs_24h), 4) if runs_24h else None,
        "orchestration_stream_runs_24h": stream_runs_24h,
        "avg_tool_step_latency_ms_24h": round(avg_step_ms, 2) if avg_step_ms else None,
        "governance_events_24h": gov_events_24h,
        "governance_metric_samples_24h": metric_samples_24h,
        "intel_events_24h": intel_events_24h,
        "governance_severity_counts_7d": severity_counts,
        "provider_rollups_7d": provider_rollups,
        "runtime_env_hints": {
            "orchestration_enabled": ai_s.orchestration_enabled,
            "ai_llm_synthesis_enabled": ai_s.ai_llm_synthesis_enabled,
            "env_provider": ai_s.provider,
            "env_fallback_provider": ai_s.fallback_provider or None,
        },
    }


def _rough_llm_cost_usd(provider: str, prompt_tokens: int, completion_tokens: int) -> float:
    """Heuristic cost only for governance dashboards (not billing)."""
    p, c = max(0, prompt_tokens), max(0, completion_tokens)
    if provider == "openai":
        return p * 0.15 / 1e6 + c * 0.60 / 1e6
    if provider == "anthropic":
        return p * 0.25 / 1e6 + c * 1.25 / 1e6
    return 0.0


def fetch_timeline(cur, *, limit: int = 120) -> list[dict[str, Any]]:
    lim = max(1, min(limit, 300))
    cur.execute(
        """
        SELECT * FROM (
            SELECT
                id::text AS entry_id,
                'governance' AS source,
                event_type AS kind,
                severity,
                created_at,
                payload_json AS payload,
                user_id,
                trace_id,
                NULL::text AS title
            FROM governance_events
            WHERE created_at >= NOW() - INTERVAL '14 days'
            UNION ALL
            SELECT
                id::text,
                'intel_feed',
                COALESCE(category, 'intel') AS kind,
                severity,
                created_at,
                jsonb_build_object(
                    'title', title, 'body', body, 'agent', agent, 'category', category
                ) AS payload,
                user_id,
                NULL::text,
                title
            FROM ai_intelligence_events
            WHERE created_at >= NOW() - INTERVAL '14 days'
        ) u
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (lim,),
    )
    rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append(
            {
                "id": row.get("entry_id"),
                "source": row.get("source"),
                "kind": row.get("kind"),
                "severity": row.get("severity"),
                "created_at": _iso(row.get("created_at")),
                "payload": row.get("payload") if isinstance(row.get("payload"), dict) else {},
                "user_id": row.get("user_id"),
                "trace_id": row.get("trace_id"),
                "title": row.get("title"),
            }
        )
    return out


def fetch_audit_runs(
    cur,
    *,
    limit: int = 40,
    offset: int = 0,
    user_id: int | None = None,
    wallet_address: str | None = None,
) -> list[dict[str, Any]]:
    lim = max(1, min(limit, 100))
    off = max(0, offset)
    params: list[Any] = []
    sql = """
        SELECT r.id, r.trace_id, r.graph_thread_id, r.memory_thread_id, r.user_id, r.execution_mode,
               r.graph_profile, r.status, r.error, r.created_at,
               u.wallet_address AS wallet_address
        FROM agent_orchestration_runs r
        LEFT JOIN users u ON u.id = r.user_id
        WHERE r.created_at >= NOW() - INTERVAL '30 days'
    """
    if user_id is not None:
        sql += " AND r.user_id = %s"
        params.append(int(user_id))
    elif wallet_address and wallet_address.strip():
        sql += " AND r.user_id = (SELECT id FROM users WHERE LOWER(wallet_address) = LOWER(%s) LIMIT 1)"
        params.append(wallet_address.strip())
    sql += " ORDER BY r.created_at DESC LIMIT %s OFFSET %s"
    params.extend([lim, off])
    cur.execute(sql, tuple(params))
    rows = cur.fetchall() or []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        out.append(
            {
                "id": int(row["id"]),
                "trace_id": row.get("trace_id"),
                "graph_thread_id": row.get("graph_thread_id"),
                "memory_thread_id": row.get("memory_thread_id"),
                "user_id": int(row["user_id"]) if row.get("user_id") is not None else None,
                "wallet_address": row.get("wallet_address"),
                "execution_mode": row.get("execution_mode"),
                "graph_profile": row.get("graph_profile"),
                "status": row.get("status"),
                "error": row.get("error"),
                "created_at": _iso(row.get("created_at")),
            }
        )
    return out


def fetch_audit_run_detail(cur, *, run_id: int) -> dict[str, Any] | None:
    cur.execute(
        """
        SELECT r.id, r.trace_id, r.graph_thread_id, r.memory_thread_id, r.user_id, r.execution_mode,
               r.graph_profile, r.status, r.error, r.policies_json, r.created_at,
               u.wallet_address
        FROM agent_orchestration_runs r
        LEFT JOIN users u ON u.id = r.user_id
        WHERE r.id = %s
        """,
        (int(run_id),),
    )
    row = cur.fetchone()
    if not row:
        return None
    if not isinstance(row, dict):
        return None
    policies = row.get("policies_json")
    if isinstance(policies, str):
        try:
            policies = json.loads(policies)
        except json.JSONDecodeError:
            policies = {}
    if not isinstance(policies, dict):
        policies = {}

    cur.execute(
        """
        SELECT step_index, step_type, tool_name, capability, ok, error, duration_ms, detail_json
        FROM agent_orchestration_steps
        WHERE run_id = %s
        ORDER BY step_index ASC
        """,
        (int(run_id),),
    )
    steps_raw = cur.fetchall() or []
    steps: list[dict[str, Any]] = []
    for s in steps_raw:
        if not isinstance(s, dict):
            continue
        det = s.get("detail_json")
        if isinstance(det, str):
            try:
                det = json.loads(det)
            except json.JSONDecodeError:
                det = {}
        if not isinstance(det, dict):
            det = {}
        steps.append(
            {
                "step_index": int(s.get("step_index") or 0),
                "step_type": s.get("step_type"),
                "tool_name": s.get("tool_name"),
                "capability": s.get("capability"),
                "ok": bool(s.get("ok")),
                "error": s.get("error"),
                "duration_ms": s.get("duration_ms"),
                "detail": det,
            }
        )

    return {
        "run": {
            "id": int(row["id"]),
            "trace_id": row.get("trace_id"),
            "graph_thread_id": row.get("graph_thread_id"),
            "memory_thread_id": row.get("memory_thread_id"),
            "user_id": int(row["user_id"]) if row.get("user_id") is not None else None,
            "wallet_address": row.get("wallet_address"),
            "execution_mode": row.get("execution_mode"),
            "graph_profile": row.get("graph_profile"),
            "status": row.get("status"),
            "error": row.get("error"),
            "created_at": _iso(row.get("created_at")),
            "policies": policies,
        },
        "steps": steps,
    }


def fetch_governance_notifications(cur) -> list[dict[str, Any]]:
    """Persisted governance events plus lightweight derived operational hints."""
    cur.execute(
        """
        SELECT id, event_type, severity, created_at, payload_json, user_id, trace_id
        FROM governance_events
        WHERE created_at >= NOW() - INTERVAL '72 hours'
          AND severity IN ('warning', 'error', 'critical')
        ORDER BY created_at DESC
        LIMIT 40
        """
    )
    rows = cur.fetchall() or []
    items: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        items.append(
            {
                "id": int(row["id"]),
                "category": "governance_event",
                "severity": row.get("severity"),
                "title": row.get("event_type"),
                "detail": row.get("payload_json") if isinstance(row.get("payload_json"), dict) else {},
                "created_at": _iso(row.get("created_at")),
                "user_id": row.get("user_id"),
                "trace_id": row.get("trace_id"),
            }
        )

    cur.execute(
        """
        SELECT
          COUNT(*)::int AS total,
          SUM(CASE WHEN (value_json->>'fallback_used')::boolean THEN 1 ELSE 0 END)::int AS fb
        FROM governance_metric_samples
        WHERE metric_key = 'llm.synthesis.complete'
          AND recorded_at >= NOW() - INTERVAL '24 hours'
        """
    )
    m = cur.fetchone() or {}
    total = int(m.get("total") or 0) if isinstance(m, dict) else int(m[0] or 0)
    fb = int(m.get("fb") or 0) if isinstance(m, dict) else int(m[1] or 0)
    if total >= 8 and fb / total >= 0.35:
        items.insert(
            0,
            {
                "id": None,
                "category": "derived",
                "severity": "warning",
                "title": "provider.fallback_elevated",
                "detail": {"message": "LLM fallback rate exceeded 35% in the last 24h.", "samples": total, "fallbacks": fb},
                "created_at": None,
                "user_id": None,
                "trace_id": None,
            },
        )

    cur.execute(
        """
        SELECT COUNT(*)::int AS n
        FROM agent_orchestration_runs
        WHERE created_at >= NOW() - INTERVAL '24 hours' AND status <> 'ok'
        """
    )
    fe = cur.fetchone() or {}
    bad = int(fe.get("n") or 0) if isinstance(fe, dict) else int(fe[0] or 0)
    if bad >= 5:
        items.insert(
            0,
            {
                "id": None,
                "category": "derived",
                "severity": "warning",
                "title": "orchestration.error_burst",
                "detail": {"message": "Multiple orchestration runs ended in error in the last 24h.", "count": bad},
                "created_at": None,
                "user_id": None,
                "trace_id": None,
            },
        )

    return items[:50]


def fetch_all_settings(cur) -> dict[str, Any]:
    cur.execute("SELECT setting_key, value_json, updated_at, updated_by_user_id FROM governance_settings")
    rows = cur.fetchall() or []
    out: dict[str, Any] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        k = str(row.get("setting_key") or "")
        v = row.get("value_json")
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except json.JSONDecodeError:
                v = {}
        if not isinstance(v, dict):
            v = {}
        out[k] = {
            "value": v,
            "updated_at": _iso(row.get("updated_at")),
            "updated_by_user_id": row.get("updated_by_user_id"),
        }
    return out
