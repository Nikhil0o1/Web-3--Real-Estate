"""Optional Redis cache for agent memory thread listings (Phase 10)."""
from __future__ import annotations

import json
import logging
from typing import Any

from backend.config.settings import MEMORY_REDIS_CACHE, MEMORY_THREADS_CACHE_TTL_S, REDIS_KEY_PREFIX
from backend.infra.redis_client import get_sync_redis

_LOG = logging.getLogger(__name__)


def _threads_key(user_id: int, limit: int) -> str:
    return f"{REDIS_KEY_PREFIX}:mem:threads:{int(user_id)}:{int(limit)}"


def get_cached_thread_list(*, user_id: int, limit: int) -> list[dict[str, Any]] | None:
    if not MEMORY_REDIS_CACHE:
        return None
    r = get_sync_redis()
    if not r:
        return None
    try:
        raw = r.get(_threads_key(user_id, limit))
        if not raw or not isinstance(raw, str):
            return None
        data = json.loads(raw)
        if not isinstance(data, list):
            return None
        return data
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("memory_cache_get_failed user=%s err=%s", user_id, exc)
        return None


def set_cached_thread_list(*, user_id: int, limit: int, rows: list[dict[str, Any]]) -> None:
    if not MEMORY_REDIS_CACHE:
        return
    r = get_sync_redis()
    if not r:
        return
    try:
        ttl = max(5, int(MEMORY_THREADS_CACHE_TTL_S))
        r.setex(_threads_key(user_id, limit), ttl, json.dumps(rows, separators=(",", ":"), default=str))
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("memory_cache_set_failed user=%s err=%s", user_id, exc)


def invalidate_thread_list_cache(*, user_id: int) -> None:
    if not MEMORY_REDIS_CACHE:
        return
    r = get_sync_redis()
    if not r:
        return
    pattern = f"{REDIS_KEY_PREFIX}:mem:threads:{int(user_id)}:*"
    try:
        for key in r.scan_iter(match=pattern, count=32):
            r.delete(key)
    except Exception as exc:  # noqa: BLE001
        _LOG.debug("memory_cache_invalidate_failed user=%s err=%s", user_id, exc)
