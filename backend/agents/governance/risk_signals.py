"""Foundational risk signals — analytics-only, no enforcement (Phase 8)."""
from __future__ import annotations

from typing import Any


def compute_risk_signals(cur) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []

    cur.execute(
        """
        SELECT r.user_id, u.wallet_address, COUNT(*)::int AS c
        FROM agent_orchestration_runs r
        JOIN users u ON u.id = r.user_id
        WHERE r.created_at >= NOW() - INTERVAL '1 hours'
        GROUP BY r.user_id, u.wallet_address
        HAVING COUNT(*) > 80
        ORDER BY c DESC
        LIMIT 20
        """
    )
    for row in cur.fetchall() or []:
        if not isinstance(row, dict):
            continue
        signals.append(
            {
                "signal_id": "orchestration.high_user_velocity",
                "severity": "warning",
                "summary": "Unusually high orchestration run volume for a single wallet in 1h.",
                "user_id": int(row["user_id"]),
                "wallet_address": row.get("wallet_address"),
                "metrics": {"runs_1h": int(row.get("c") or 0)},
            }
        )

    cur.execute(
        """
        SELECT s.tool_name, r.user_id, u.wallet_address, COUNT(*)::int AS c
        FROM agent_orchestration_steps s
        JOIN agent_orchestration_runs r ON r.id = s.run_id
        JOIN users u ON u.id = r.user_id
        WHERE r.created_at >= NOW() - INTERVAL '24 hours'
          AND (s.capability ILIKE '%tx%' OR s.tool_name ILIKE '%tx%prep%' OR s.tool_name ILIKE '%prepare%')
        GROUP BY s.tool_name, r.user_id, u.wallet_address
        HAVING COUNT(*) > 40
        ORDER BY c DESC
        LIMIT 20
        """
    )
    for row in cur.fetchall() or []:
        if not isinstance(row, dict):
            continue
        signals.append(
            {
                "signal_id": "tx_prep.high_frequency",
                "severity": "info",
                "summary": "Elevated transaction-preparation tool activity (24h window).",
                "user_id": int(row["user_id"]),
                "wallet_address": row.get("wallet_address"),
                "metrics": {"tool_name": row.get("tool_name"), "steps_24h": int(row.get("c") or 0)},
            }
        )

    cur.execute(
        """
        SELECT investor_wallet AS wallet, COUNT(*)::int AS c
        FROM investments
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY investor_wallet
        HAVING COUNT(*) > 12
        ORDER BY c DESC
        LIMIT 20
        """
    )
    for row in cur.fetchall() or []:
        if not isinstance(row, dict):
            continue
        signals.append(
            {
                "signal_id": "investment.burst_frequency",
                "severity": "info",
                "summary": "High investment record creation rate for one wallet (24h).",
                "wallet_address": row.get("wallet"),
                "metrics": {"investment_rows_24h": int(row.get("c") or 0)},
            }
        )

    cur.execute(
        """
        SELECT t.wallet_address, COUNT(*)::int AS c
        FROM rent_payments rp
        JOIN tenants t ON t.id = rp.tenant_id
        WHERE rp.payment_date >= NOW() - INTERVAL '24 hours'
        GROUP BY t.wallet_address
        HAVING COUNT(*) > 8
        ORDER BY c DESC
        LIMIT 20
        """
    )
    for row in cur.fetchall() or []:
        if not isinstance(row, dict):
            continue
        signals.append(
            {
                "signal_id": "rent_payment.high_frequency",
                "severity": "info",
                "summary": "Unusually frequent rent payment records for a tenant wallet (24h).",
                "wallet_address": row.get("wallet_address"),
                "metrics": {"payments_24h": int(row.get("c") or 0)},
            }
        )

    cur.execute(
        """
        SELECT agent, COUNT(*)::int AS c
        FROM ai_intelligence_events
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY agent
        HAVING COUNT(*) > 200
        ORDER BY c DESC
        LIMIT 10
        """
    )
    for row in cur.fetchall() or []:
        if not isinstance(row, dict):
            continue
        signals.append(
            {
                "signal_id": "autonomous_agent.high_volume",
                "severity": "info",
                "summary": "Autonomous intelligence agent produced many events in 24h.",
                "metrics": {"agent": row.get("agent"), "events_24h": int(row.get("c") or 0)},
            }
        )

    cur.execute(
        """
        SELECT dimensions_json->>'provider' AS provider, COUNT(*)::int AS c
        FROM governance_metric_samples
        WHERE metric_key = 'llm.synthesis.complete'
          AND recorded_at >= NOW() - INTERVAL '6 hours'
        GROUP BY 1
        HAVING COUNT(*) > 500
        ORDER BY c DESC
        LIMIT 5
        """
    )
    for row in cur.fetchall() or []:
        if not isinstance(row, dict):
            continue
        signals.append(
            {
                "signal_id": "llm.usage_spike",
                "severity": "info",
                "summary": "High LLM synthesis sample volume in a short window (governance metric).",
                "metrics": {"provider": row.get("provider"), "samples_6h": int(row.get("c") or 0)},
            }
        )

    return signals
