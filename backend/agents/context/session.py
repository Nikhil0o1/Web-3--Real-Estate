"""Request-scoped orchestration identity (wallet + role + trace)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.services.auth import AuthUser, canonical_role


@dataclass(frozen=True)
class OrchestrationContext:
    """Isolated context for a single orchestration / stream invocation."""

    user_id: int
    wallet_address: str
    platform_role: str
    trace_id: str
    dashboard_surface: str | None = None
    extras: dict[str, Any] = field(default_factory=dict)

    def as_log_extra(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "wallet_address": self.wallet_address,
            "platform_role": self.platform_role,
            "trace_id": self.trace_id,
            "dashboard_surface": self.dashboard_surface,
        }


def context_from_auth_user(user: AuthUser, *, trace_id: str, dashboard_surface: str | None = None) -> OrchestrationContext:
    role = canonical_role(user.role)
    return OrchestrationContext(
        user_id=int(user.id),
        wallet_address=str(user.wallet_address),
        platform_role=role,
        trace_id=trace_id,
        dashboard_surface=dashboard_surface,
        extras={},
    )
