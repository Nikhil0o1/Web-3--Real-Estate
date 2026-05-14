"""Deterministic tenant narratives from orchestration analytics."""
from __future__ import annotations

from typing import Any


def build_tenant_narrative(
    *,
    intent: str,
    prompt_context: dict[str, Any],
    working: dict[str, Any],
) -> tuple[str, str]:
    summary = working.get("tenant.get_tenant_payment_summary") or {}
    reminder = working.get("tenant.next_payment_reminder") or {}
    forecast = working.get("tenant.forecast_rent_obligations") or {}
    behavior = working.get("tenant.analyze_payment_behavior") or {}
    affordability = working.get("tenant.calculate_affordability_metrics") or {}
    rentals = (working.get("tenant.active_rentals") or {}).get("result") or []

    parts: list[str] = []
    if summary:
        parts.append(
            f"Payment history: {summary.get('payment_count', 0)} payments, total {summary.get('total_paid_eth', '0')} ETH."
        )
    if reminder:
        parts.append(
            f"Next due marker: {reminder.get('next_due_date')} with monthly obligation {reminder.get('monthly_obligation_eth', '0')} ETH."
        )
    if forecast:
        parts.append(
            f"Forecast over {forecast.get('horizon_months', '?')} months: {forecast.get('projected_total_eth', '0')} ETH."
        )
    if behavior:
        parts.append(
            f"Payment consistency ratio: {behavior.get('consistency_ratio', '0')} across {behavior.get('window_months', 0)} months."
        )
    if affordability:
        parts.append(
            f"Affordability health: {affordability.get('affordability_health', 'unknown')} (coverage_months={affordability.get('coverage_months')})."
        )
    if rentals:
        parts.append(f"Active rentals tracked: {len(rentals)}.")
    if not parts:
        parts.append("No tenant-specific analytics were returned for this turn.")
    reasoning = " ".join(parts)

    if intent == "rent_reminder":
        msg = "Here is your next rent reminder and current obligation view."
    elif intent == "payment_summary":
        msg = "Here is a summary of your recent rental payment activity."
    elif intent == "affordability_analysis":
        msg = "Here is your affordability snapshot based on wallet balance and recurring rental obligations."
    elif intent == "rent_forecast":
        msg = "Here is your projected rent-obligation forecast."
    else:
        msg = "Here is your rental-intelligence summary from deterministic tenant analytics."
    return msg, reasoning
