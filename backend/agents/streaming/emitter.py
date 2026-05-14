"""Async streaming helpers — backend-only; UI wiring comes later."""
from __future__ import annotations

import asyncio
import json
import math
from decimal import Decimal
from typing import Any, AsyncIterator

from backend.agents.config.settings import get_ai_settings
from backend.agents.streaming.buffer_helper import buffer_sse


def _json_sse_safe(obj: Any) -> Any:
    """Ensure payloads are strict JSON (``JSON.parse`` in browsers rejects NaN/Infinity)."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, Decimal):
        try:
            f = float(obj)
            return f if math.isfinite(f) else None
        except (TypeError, ValueError, OverflowError):
            return str(obj)
    if isinstance(obj, dict):
        return {str(k): _json_sse_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_sse_safe(v) for v in obj]
    if isinstance(obj, tuple):
        return [_json_sse_safe(v) for v in obj]
    return obj


def format_sse(data: dict[str, Any], *, event: str | None = None) -> str:
    """Format one Server-Sent Events frame."""
    lines: list[str] = []
    if event:
        lines.append(f"event: {event}")
    safe = _json_sse_safe(data)
    lines.append(f"data: {json.dumps(safe, default=str, allow_nan=False)}")
    lines.append("")
    lines.append("")
    return "\n".join(lines)


async def stream_agent_test_events(*, trace_id: str, wallet: str, role: str) -> AsyncIterator[str]:
    """Synthetic stream to validate proxies / timeouts / client parsers."""
    settings = get_ai_settings()
    delay = settings.stream_test_delay_s
    start_payload = {"phase": "start", "trace_id": trace_id}
    yield format_sse(start_payload, event="lifecycle")
    await buffer_sse(trace_id=trace_id, event="lifecycle", payload=start_payload)
    await asyncio.sleep(delay)
    tok = {"chunk": "[orchestration_test]", "trace_id": trace_id}
    yield format_sse(tok, event="token")
    await buffer_sse(trace_id=trace_id, event="token", payload=tok)
    await asyncio.sleep(delay)
    end_payload = {"phase": "end", "trace_id": trace_id, "wallet": wallet, "role": role}
    yield format_sse(end_payload, event="lifecycle")
    await buffer_sse(trace_id=trace_id, event="lifecycle", payload=end_payload)


async def stream_orchestration_run(
    *,
    ctx,
    db,
    trace_id: str,
    dashboard_surface: str | None,
    graph_thread_id: str | None,
    memory_thread_id: int | None,
) -> AsyncIterator[str]:
    """SSE over LangGraph ``astream`` value chunks (orchestration-native streaming)."""
    from backend.agents.runtime.executor import AgentRuntime

    start_payload = {"phase": "start", "trace_id": trace_id}
    yield format_sse(start_payload, event="lifecycle")
    await buffer_sse(trace_id=trace_id, event="lifecycle", payload=start_payload)
    runtime = AgentRuntime()
    async for row in runtime.astream_orchestration_values(
        ctx,
        db,
        dashboard_surface=dashboard_surface,
        execution_mode="ping",
        graph_thread_id=graph_thread_id,
        memory_thread_id=memory_thread_id,
    ):
        yield format_sse(row, event="orchestration")
        pl = row if isinstance(row, dict) else {"payload": str(row)}
        await buffer_sse(trace_id=trace_id, event="orchestration", payload=pl)
    end_payload = {"phase": "end", "trace_id": trace_id}
    yield format_sse(end_payload, event="lifecycle")
    await buffer_sse(trace_id=trace_id, event="lifecycle", payload=end_payload)
