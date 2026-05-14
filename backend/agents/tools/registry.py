"""Central registry for orchestration tools (registration + dispatch)."""
from __future__ import annotations

import logging
from dataclasses import replace
from typing import Any

from backend.agents.context.session import OrchestrationContext
from backend.agents.observability.logging import get_agent_logger, log_orchestration_event
from backend.agents.tools.base import ToolResult, ToolSpec

_LOGGER = get_agent_logger("tools.registry")


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.meta.name in self._tools:
            raise ValueError(f"Duplicate tool registration: {spec.meta.name}")
        self._tools[spec.meta.name] = spec
        _LOGGER.info("registered tool %s", spec.meta.name)

    def get_spec(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def list_metadata(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for spec in self._tools.values():
            roles = None if spec.meta.allowed_roles is None else sorted(spec.meta.allowed_roles)
            out.append(
                {
                    "name": spec.meta.name,
                    "description": spec.meta.description,
                    "allowed_roles": roles,
                    "requires_on_chain": spec.meta.requires_on_chain,
                    "categories": list(spec.meta.categories),
                    "capability": spec.meta.capability.value,
                }
            )
        return sorted(out, key=lambda x: x["name"])

    def list_metadata_for_role(self, role: str) -> list[dict[str, Any]]:
        role_l = role.strip().lower()
        out: list[dict[str, Any]] = []
        for spec in self._tools.values():
            if not self._role_allowed(spec, role_l):
                continue
            roles = None if spec.meta.allowed_roles is None else sorted(spec.meta.allowed_roles)
            out.append(
                {
                    "name": spec.meta.name,
                    "description": spec.meta.description,
                    "allowed_roles": roles,
                    "requires_on_chain": spec.meta.requires_on_chain,
                    "categories": list(spec.meta.categories),
                    "capability": spec.meta.capability.value,
                }
            )
        return sorted(out, key=lambda x: x["name"])

    def _role_allowed(self, spec: ToolSpec, role: str) -> bool:
        allowed = spec.meta.allowed_roles
        if allowed is None:
            return True
        return role.lower() in {r.lower() for r in allowed}

    async def invoke(
        self,
        name: str,
        ctx: OrchestrationContext,
        arguments: dict[str, Any],
        *,
        db: Any | None = None,
    ) -> ToolResult:
        if db is not None:
            ctx = replace(ctx, extras={**ctx.extras, "_agent_db": db})
        spec = self._tools.get(name)
        if not spec:
            log_orchestration_event(_LOGGER, "tool_missing", trace_id=ctx.trace_id, extra={"tool": name})
            return ToolResult(ok=False, error=f"Unknown tool: {name}")
        if not self._role_allowed(spec, ctx.platform_role):
            log_orchestration_event(
                _LOGGER,
                "tool_forbidden",
                trace_id=ctx.trace_id,
                extra={"tool": name, "role": ctx.platform_role},
                level=logging.WARNING,
            )
            return ToolResult(ok=False, error="TOOL_FORBIDDEN_FOR_ROLE")
        if spec.meta.requires_on_chain:
            return ToolResult(ok=False, error="ON_CHAIN_TOOLS_DISABLED")
        log_orchestration_event(_LOGGER, "tool_start", trace_id=ctx.trace_id, extra={"tool": name})
        try:
            result = await spec.handler(ctx, arguments)
        except Exception as exc:  # noqa: BLE001 — tool boundary
            _LOGGER.exception("tool_failure name=%s trace=%s", name, ctx.trace_id)
            return ToolResult(ok=False, error=str(exc))
        status = "tool_ok" if result.ok else "tool_error"
        log_orchestration_event(
            _LOGGER,
            status,
            trace_id=ctx.trace_id,
            extra={"tool": name, "ok": result.ok},
            level=logging.INFO if result.ok else logging.WARNING,
        )
        return result


_REGISTRY: ToolRegistry | None = None


def get_tool_registry() -> ToolRegistry:
    global _REGISTRY
    if _REGISTRY is None:
        from backend.agents.tools import builtin as builtin_tools
        from backend.agents.tools import phase2_register

        _REGISTRY = ToolRegistry()
        builtin_tools.register_builtin_tools(_REGISTRY)
        phase2_register.register_phase2_tools(_REGISTRY)
    return _REGISTRY
