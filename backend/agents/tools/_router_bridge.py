"""Call existing FastAPI route handlers in-process (prepare/confirm parity, no new business rules)."""
from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException

from backend.agents.context.session import OrchestrationContext
from backend.agents.tools.base import ToolResult
from backend.services.auth import AuthUser


def auth_user_from_orchestration(ctx: OrchestrationContext) -> AuthUser:
    """Minimal ``AuthUser`` for calling route handlers that expect authenticated users."""
    return AuthUser(
        id=int(ctx.user_id),
        wallet_address=str(ctx.wallet_address),
        role=str(ctx.platform_role),
        email=None,
        kyc_status="",
        active=True,
    )


def get_tool_db(ctx: OrchestrationContext):
    return ctx.extras.get("_agent_db")


def http_exception_to_tool_result(exc: HTTPException) -> ToolResult:
    detail = exc.detail
    if isinstance(detail, dict):
        err = json.dumps(detail, default=str)
        body = detail
    else:
        err = str(detail)
        body = {"detail": detail}
    return ToolResult(ok=False, error=err, data={"status_code": exc.status_code, "body": body})


def sync_route_tool(name: str, fn, **kwargs) -> ToolResult:
    """Run a synchronous route function with explicit kwargs (no ``Depends`` resolution)."""
    try:
        out = fn(**kwargs)
        if hasattr(out, "model_dump"):
            return ToolResult(ok=True, data={"result": out.model_dump(mode="json")})
        if isinstance(out, dict):
            return ToolResult(ok=True, data={"result": out})
        return ToolResult(ok=True, data={"result": out})
    except HTTPException as exc:
        return http_exception_to_tool_result(exc)
    except Exception as exc:  # noqa: BLE001
        return ToolResult(ok=False, error=str(exc), data={"tool": name})
