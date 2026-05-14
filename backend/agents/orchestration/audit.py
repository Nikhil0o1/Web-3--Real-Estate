"""Durable orchestration audit rows (runs + ordered steps).

Uses a dedicated DB connection so audit commits do not interfere with the
request-scoped connection used by tools.
"""
from __future__ import annotations

import json
from typing import Any

from backend.db.connection import get_connection


def persist_orchestration_run(
    *,
    trace_id: str,
    graph_thread_id: str,
    memory_thread_id: int | None,
    user_id: int,
    execution_mode: str,
    graph_profile: str,
    ok: bool,
    error: str | None,
    execution_trace: list[dict[str, Any]],
    policies: dict[str, Any] | None = None,
) -> int | None:
    """Insert one run row and child step rows. Returns run id or None on failure."""
    db = get_connection()
    cur = db.cursor()
    try:
        cur.execute(
            """
            INSERT INTO agent_orchestration_runs (
                trace_id, graph_thread_id, memory_thread_id, user_id, execution_mode,
                graph_profile, status, error, policies_json
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id
            """,
            (
                trace_id,
                graph_thread_id,
                memory_thread_id,
                user_id,
                execution_mode,
                graph_profile,
                "ok" if ok else "error",
                error,
                json.dumps(policies or {}, separators=(",", ":")),
            ),
        )
        row = cur.fetchone()
        run_id = int(row[0]) if row else None
        if run_id is None:
            return None
        for i, step in enumerate(execution_trace):
            cur.execute(
                """
                INSERT INTO agent_orchestration_steps (
                    run_id, step_index, step_type, tool_name, capability, ok, error,
                    duration_ms, detail_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    run_id,
                    i,
                    str(step.get("step_type", "unknown")),
                    step.get("tool_name"),
                    step.get("capability"),
                    bool(step.get("ok", False)),
                    step.get("error"),
                    step.get("duration_ms"),
                    json.dumps(step.get("detail") or {}, separators=(",", ":")),
                ),
            )
        db.commit()
        try:
            from backend.agents.governance.store import record_governance_event

            record_governance_event(
                event_type="orchestration.run",
                severity="info" if ok else "warning",
                user_id=int(user_id),
                trace_id=trace_id,
                source="orchestration_audit",
                payload={
                    "run_id": run_id,
                    "execution_mode": execution_mode,
                    "graph_profile": graph_profile,
                    "ok": ok,
                    "error": error,
                    "step_count": len(execution_trace),
                },
            )
        except Exception:
            pass
        return run_id
    except Exception:
        db.rollback()
        raise
    finally:
        cur.close()
        db.close()
