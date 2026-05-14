"""Async helpers for optional Redis stream buffering (Phase 10)."""
from __future__ import annotations

import asyncio
from typing import Any

from backend.infra.stream_buffer import record_stream_payload


async def buffer_sse(*, trace_id: str, event: str, payload: dict[str, Any]) -> None:
    if not trace_id:
        return
    await asyncio.to_thread(record_stream_payload, trace_id=trace_id, event=event, payload=payload)
