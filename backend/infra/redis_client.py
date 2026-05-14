"""Optional Redis client (sync). Disabled when ``REDIS_URL`` is unset."""
from __future__ import annotations

import logging
from typing import Any

from backend.config.settings import REDIS_URL
from backend.infra.resilience import redis_breaker

_LOG = logging.getLogger(__name__)
_client: Any = None


def redis_enabled() -> bool:
    return bool(REDIS_URL)


def get_sync_redis():
    """Return a shared sync Redis client or ``None`` if disabled / unavailable."""
    global _client
    if not REDIS_URL:
        return None
    if _client is not None:
        return _client

    def _connect():
        import redis

        return redis.Redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=2.0, socket_timeout=2.0)

    try:
        cli = redis_breaker.call(_connect)
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("redis_connect_failed err=%s", exc)
        return None
    if cli is None:
        return None
    try:
        cli.ping()
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("redis_ping_failed err=%s", exc)
        return None
    _client = cli
    return _client


def redis_ping_ok() -> bool:
    r = get_sync_redis()
    if not r:
        return False
    try:
        return bool(r.ping())
    except Exception:
        return False
