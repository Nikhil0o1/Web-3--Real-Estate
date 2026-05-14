"""Helpers for mapping unified orchestration graph output to legacy tool shapes."""
from __future__ import annotations

from typing import Any

from backend.agents.tools.base import ToolResult


def extract_last_tool_result(out: dict[str, Any]) -> ToolResult:
    """Map graph ``tool_results`` tail to the Phase-2 ``ToolResult`` contract."""
    trs = out.get("tool_results") or []
    if not trs:
        return ToolResult(ok=False, error="NO_TOOL_RESULT")
    last = trs[-1]
    if not isinstance(last, dict):
        return ToolResult(ok=False, error="INVALID_TOOL_RESULT")
    return ToolResult(
        ok=bool(last.get("ok")),
        data=dict(last.get("data") or {}),
        error=last.get("error"),
    )
