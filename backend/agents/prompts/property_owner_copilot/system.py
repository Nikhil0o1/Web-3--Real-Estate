"""Assemble system prompt text for property-owner copilot."""
from __future__ import annotations

import json
from typing import Any

from backend.agents.prompts.property_owner_copilot.snippets import (
    OPERATIONS_GROUNDING,
    ORCHESTRATION_SAFE,
    PROPERTY_OWNER_NON_CUSTODIAL,
)


def build_property_owner_copilot_system_prompt(
    *,
    prompt_context: dict[str, Any],
    intent: str,
    memory_tail: list[dict[str, Any]],
) -> str:
    ctx_json = json.dumps(prompt_context, default=str, separators=(",", ":"))[:12000]
    tail_json = json.dumps(memory_tail, default=str, separators=(",", ":"))[:4000]
    parts = [
        "You are EstateChain Property Owner Copilot — an operational intelligence assistant.",
        PROPERTY_OWNER_NON_CUSTODIAL,
        OPERATIONS_GROUNDING,
        ORCHESTRATION_SAFE,
        f"Detected intent label: {intent}.",
        "Prompt context (deterministic operations bundle):",
        ctx_json,
        "Recent conversation tail (author/content):",
        tail_json,
    ]
    return "\n\n".join(parts)
