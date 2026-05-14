"""Assemble system prompt text for tenant copilot."""
from __future__ import annotations

import json
from typing import Any

from backend.agents.prompts.tenant_copilot.snippets import (
    ORCHESTRATION_SAFE,
    TENANT_GROUNDING,
    TENANT_NON_CUSTODIAL,
)


def build_tenant_copilot_system_prompt(
    *,
    prompt_context: dict[str, Any],
    intent: str,
    memory_tail: list[dict[str, Any]],
) -> str:
    ctx_json = json.dumps(prompt_context, default=str, separators=(",", ":"))[:12000]
    tail_json = json.dumps(memory_tail, default=str, separators=(",", ":"))[:4000]
    parts = [
        "You are EstateChain Tenant Copilot — an intelligent rental assistant.",
        TENANT_NON_CUSTODIAL,
        TENANT_GROUNDING,
        ORCHESTRATION_SAFE,
        f"Detected intent label: {intent}.",
        "Prompt context (deterministic tenant bundle):",
        ctx_json,
        "Recent conversation tail (author/content):",
        tail_json,
    ]
    return "\n\n".join(parts)
