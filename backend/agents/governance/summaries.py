"""Deterministic admin intelligence narratives (no extra LLM spend)."""
from __future__ import annotations

from typing import Any

from backend.agents.governance import queries as gq
from backend.agents.governance import risk_signals


def build_admin_brief(cur) -> str:
    ov: dict[str, Any] = gq.fetch_overview(cur)
    risks = risk_signals.compute_risk_signals(cur)
    notes = gq.fetch_governance_notifications(cur)

    lines: list[str] = []
    lines.append("## Platform governance brief")
    lines.append("")
    lines.append(
        f"- Orchestration runs (24h): **{ov.get('orchestration_runs_24h', 0)}** "
        f"(ok rate: **{ov.get('orchestration_ok_rate_24h') or 'n/a'}**)."
    )
    lines.append(f"- Streaming copilot runs (24h): **{ov.get('orchestration_stream_runs_24h', 0)}**.")
    lines.append(f"- Governance timeline events (24h): **{ov.get('governance_events_24h', 0)}**.")
    lines.append(f"- Intelligence feed events (24h): **{ov.get('intel_events_24h', 0)}**.")
    avg_lat = ov.get("avg_tool_step_latency_ms_24h")
    if avg_lat:
        lines.append(f"- Mean audited tool step latency (24h): **{avg_lat} ms**.")
    roll = ov.get("provider_rollups_7d") or []
    if roll:
        lines.append("")
        lines.append("### Provider economics (7d, heuristic)")
        for r in roll[:6]:
            lines.append(
                f"- **{r.get('provider')}**: samples={r.get('samples_7d')}, "
                f"fallback_rate={r.get('fallback_rate_7d')}, est_cost_usd≈{r.get('estimated_cost_usd_7d')}"
            )
    if risks:
        lines.append("")
        lines.append(f"### Risk analytics ({len(risks)} active signals)")
        for s in risks[:8]:
            lines.append(f"- [{s.get('severity')}] {s.get('summary')}")
    else:
        lines.append("")
        lines.append("### Risk analytics")
        lines.append("- No threshold-based risk signals in the current windows.")

    if notes:
        lines.append("")
        lines.append("### Operational notifications")
        for n in notes[:6]:
            lines.append(f"- **{n.get('title')}** ({n.get('severity')})")

    hints = ov.get("runtime_env_hints") or {}
    lines.append("")
    lines.append("### Runtime posture")
    lines.append(
        f"- Orchestration enabled (env): **{hints.get('orchestration_enabled')}**; "
        f"LLM synthesis enabled: **{hints.get('ai_llm_synthesis_enabled')}**."
    )
    lines.append(
        f"- Default provider (env): **{hints.get('env_provider')}**; "
        f"fallback: **{hints.get('env_fallback_provider') or 'none'}**."
    )
    return "\n".join(lines)
