"""Tool contracts — async-safe, role-gated, no chain signing."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Awaitable, Callable, FrozenSet

from backend.agents.context.session import OrchestrationContext


class ToolCapability(str, Enum):
    """Orchestration safety / policy surface (non-custodial rules stay in handlers)."""

    READ_ONLY = "read_only"
    TX_PREPARATION = "tx_preparation"
    MUTATING_INTERNAL = "mutating_internal"
    SYSTEM = "system"


@dataclass(frozen=True)
class ToolMetadata:
    name: str
    description: str
    allowed_roles: FrozenSet[str] | None = None
    """None means all authenticated roles."""

    requires_on_chain: bool = False
    """Must remain False until an explicit human-in-the-loop design exists."""

    categories: tuple[str, ...] = ()
    """Logical grouping for routing / observability (e.g. ``marketplace``, ``investor``)."""

    capability: ToolCapability = ToolCapability.READ_ONLY
    """Used by the unified orchestration runtime for policy + audit."""


@dataclass
class ToolResult:
    ok: bool
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


ToolContext = OrchestrationContext
ToolHandler = Callable[[ToolContext, dict[str, Any]], Awaitable[ToolResult]]


@dataclass(frozen=True)
class ToolSpec:
    meta: ToolMetadata
    handler: ToolHandler
