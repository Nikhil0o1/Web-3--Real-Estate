"""Assemble system-side prompt text for investor copilot (Phase 3)."""
from __future__ import annotations

import json
from typing import Any

from backend.agents.prompts.investor_copilot.snippets import (
    FINANCIAL_GROUNDING,
    INVESTOR_NON_CUSTODIAL,
    ORCHESTRATION_SAFE,
)


def build_investor_copilot_system_prompt(
    *,
    prompt_context: dict[str, Any],
    intent: str,
    memory_tail: list[dict[str, Any]],
) -> str:
    """Compact system prompt for future LLM turns; today used for logging / future wiring."""
    ctx_json = json.dumps(prompt_context, default=str, separators=(",", ":"))[:12000]
    tail_json = json.dumps(memory_tail, default=str, separators=(",", ":"))[:4000]
    parts = [
        "You are EstateChain Investor Copilot — an advisory orchestration assistant.",
        INVESTOR_NON_CUSTODIAL,
        FINANCIAL_GROUNDING,
        ORCHESTRATION_SAFE,
        f"Detected intent label: {intent}.",
        "Prompt context (deterministic analytics bundle):",
        ctx_json,
        "Recent conversation tail (author/content):",
        tail_json,
    ]
    return "\n\n".join(parts)
