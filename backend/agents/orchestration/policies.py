"""Execution governance scaffolding (role + capability + future budgets)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from backend.agents.context.session import OrchestrationContext
from backend.agents.tools.base import ToolCapability, ToolSpec


@dataclass(frozen=True)
class ExecutionPolicyOutcome:
    allowed: bool
    reason: str | None = None


def evaluate_tool_execution(
    ctx: OrchestrationContext,
    spec: ToolSpec | None,
    *,
    execution_mode: str,
) -> ExecutionPolicyOutcome:
    """Deterministic pre-flight for orchestrated tool runs (graph policy node)."""
    _ = execution_mode
    if spec is None:
        return ExecutionPolicyOutcome(False, "UNKNOWN_TOOL")
    if spec.meta.requires_on_chain:
        return ExecutionPolicyOutcome(False, "ON_CHAIN_TOOLS_DISABLED")
    allowed = spec.meta.allowed_roles
    if allowed is not None and ctx.platform_role.lower() not in {r.lower() for r in allowed}:
        return ExecutionPolicyOutcome(False, "TOOL_FORBIDDEN_FOR_ROLE")
    cap = spec.meta.capability
    if cap == ToolCapability.MUTATING_INTERNAL:
        # Reserved for future server-side mutations under explicit approval.
        return ExecutionPolicyOutcome(False, "MUTATING_INTERNAL_DISABLED")
    return ExecutionPolicyOutcome(True, None)


def execution_budget_stub(_ctx: OrchestrationContext, _tool_name: str) -> ExecutionPolicyOutcome:
    """Placeholder for per-tenant rate limits / spend caps (Phase 3+)."""
    return ExecutionPolicyOutcome(True, None)
