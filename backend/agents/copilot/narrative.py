"""Deterministic investor narratives from analytics facts (no LLM hallucination)."""
from __future__ import annotations

from typing import Any


def build_investor_narrative(
    *,
    intent: str,
    prompt_context: dict[str, Any],
    portfolio: dict[str, Any] | None,
    passive: dict[str, Any] | None,
    ranked: list[dict[str, Any]],
) -> tuple[str, str]:
    """Return (user_message_style_reply, reasoning_summary)."""
    div = (portfolio or {}).get("diversification") or prompt_context.get("diversification") or {}
    hhi = div.get("herfindahl_index") or div.get("herfindahl")
    n_props = div.get("property_count") or (portfolio or {}).get("holdings") and len((portfolio or {}).get("holdings") or [])
    parts: list[str] = []
    if intent in ("portfolio_risk", "diversification", "general", "compare_holdings"):
        if hhi is not None:
            parts.append(f"Portfolio Herfindahl index (concentration): {hhi}.")
        if n_props:
            parts.append(f"Properties tracked in portfolio analytics: {n_props}.")
    if intent in ("passive_income", "reinvest_question", "best_yield") and passive:
        res = passive.get("rewards") or passive.get("result") or {}
        claimable = res.get("total_claimable_wei")
        claimed = res.get("total_claimed_wei")
        if claimable is not None:
            parts.append(f"Unclaimed rewards (wei): {claimable}.")
        if claimed is not None:
            parts.append(f"Lifetime claimed rewards (wei): {claimed}.")
    if intent in ("discover_opportunities", "invest_prepare", "best_yield") and ranked:
        top = ranked[0]
        parts.append(
            f"Top ranked opportunity by explainable score: property {top.get('property_id')} "
            f"({top.get('name') or 'unnamed'}) — {top.get('why', '')}"
        )
    if not parts:
        parts.append("No additional deterministic narrative beyond supplied analytics bundle.")
    reasoning = " ".join(parts)
    # Short user-facing message
    if intent == "invest_prepare" and ranked:
        msg = (
            f"I ranked opportunities using on-chain/database analytics. Top pick: property {ranked[0].get('property_id')}. "
            "If a transaction payload is attached, review it in MetaMask — the platform never signs for you."
        )
    elif intent in ("portfolio_risk", "diversification"):
        msg = "Here is a concentration-focused readout based on your current holdings snapshot and diversification metrics."
    elif intent in ("passive_income", "reinvest_question"):
        msg = "Here is a rewards and passive-income snapshot from reconciled claimable data."
    elif intent in ("discover_opportunities", "best_yield"):
        msg = "Here are ranked opportunities from marketplace and yield heuristics you already use in dashboards."
    else:
        msg = "Here is an orchestrated snapshot from your investor analytics bundle and latest tool pulls."
    return msg, reasoning
