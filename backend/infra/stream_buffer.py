"""Redis-backed stream chunk ring buffer for SSE replay (Phase 10)."""
from __future__ import annotations

import json
import logging
from typing import Any

from backend.config.settings import REDIS_KEY_PREFIX, STREAM_BUFFER_MAX_EVENTS, STREAM_REDIS_BUFFER
from backend.infra.redis_client import get_sync_redis

_LOG = logging.getLogger(__name__)


def _key(trace_id: str) -> str:
    return f"{REDIS_KEY_PREFIX}:streambuf:{trace_id}"


def record_stream_payload(*, trace_id: str, event: str, payload: dict[str, Any]) -> None:
    if not STREAM_REDIS_BUFFER or not trace_id:
        return
    r = get_sync_redis()
    if not r:
        return
    try:
        body = json.dumps({"event": event, "data": payload}, separators=(",", ":"), default=str)
        if len(body) > 16_384:
            body = body[:16_000] + "…"
        pipe = r.pipeline(transaction=False)
        pipe.lpush(_key(trace_id), body)
        pipe.ltrim(_key(trace_id), 0, max(10, STREAM_BUFFER_MAX_EVENTS) - 1)
        pipe.expire(_key(trace_id), 86400)
        pipe.execute()
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("stream_buffer_write_failed trace=%s err=%s", trace_id, exc)


def read_stream_buffer(*, trace_id: str, limit: int = 200) -> list[dict[str, Any]]:
    r = get_sync_redis()
    if not r or not trace_id:
        return []
    lim = max(1, min(limit, 500))
    try:
        raw = r.lrange(_key(trace_id), 0, lim - 1)
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("stream_buffer_read_failed trace=%s err=%s", trace_id, exc)
        return []
    out: list[dict[str, Any]] = []
    for item in reversed(raw or []):
        if not isinstance(item, str):
            continue
        try:
            out.append(json.loads(item))
        except json.JSONDecodeError:
            continue
    return out
