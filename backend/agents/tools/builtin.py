"""Built-in tools for infrastructure validation (no domain / chain side-effects)."""
from __future__ import annotations

from typing import Any

from backend.agents.tools.base import ToolCapability, ToolMetadata, ToolResult, ToolSpec
from backend.agents.tools.registry import ToolRegistry


async def _orchestration_ping(ctx, _arguments: dict[str, Any]):
    _ = _arguments
    return ToolResult(
        ok=True,
        data={
            "wallet": ctx.wallet_address,
            "role": ctx.platform_role,
            "trace_id": ctx.trace_id,
        },
    )


def register_builtin_tools(registry: ToolRegistry) -> None:
    registry.register(
        ToolSpec(
            meta=ToolMetadata(
                name="orchestration.ping",
                description="No-op orchestration probe (Phase 1 infrastructure).",
                allowed_roles=None,
                requires_on_chain=False,
                capability=ToolCapability.SYSTEM,
            ),
            handler=_orchestration_ping,
        )
    )
