"""Distributed job queues (Redis). Optional; no-op when ``REDIS_URL`` is unset."""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from backend.config.settings import (
    AUTONOMOUS_QUEUE_DISPATCH,
    REDIS_KEY_PREFIX,
    REDIS_URL,
)
from backend.infra.redis_client import get_sync_redis

_LOG = logging.getLogger(__name__)


def autonomous_queue_dispatch_enabled() -> bool:
    return bool(REDIS_URL and AUTONOMOUS_QUEUE_DISPATCH)


def _q_main() -> str:
    return f"{REDIS_KEY_PREFIX}:queue:autonomous:tick"


def _q_dlq() -> str:
    return f"{REDIS_KEY_PREFIX}:queue:autonomous:dlq"


def enqueue_autonomous_tick(*, source: str = "unknown") -> bool:
    """LPUSH a tick job. Returns ``True`` if queued."""
    if not autonomous_queue_dispatch_enabled():
        return False
    r = get_sync_redis()
    if not r:
        return False
    job = {"v": 1, "type": "autonomous_tick", "source": source[:64], "ts": time.time()}
    try:
        r.lpush(_q_main(), json.dumps(job, separators=(",", ":")))
        return True
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("enqueue_autonomous_tick_failed err=%s", exc)
        return False


def brpop_autonomous_job(*, timeout_s: int = 5) -> dict[str, Any] | None:
    """Blocking pop (worker). FIFO via RPOP side."""
    r = get_sync_redis()
    if not r:
        return None
    try:
        out = r.brpop(_q_main(), timeout=timeout_s)
        if not out:
            return None
        _, raw = out
        if isinstance(raw, str):
            return json.loads(raw)
        return None
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("brpop_autonomous_job_failed err=%s", exc)
        return None


def push_dlq(job: dict[str, Any], err: str) -> None:
    r = get_sync_redis()
    if not r:
        return
    try:
        payload = {"job": job, "error": err[:2000], "ts": time.time()}
        r.lpush(_q_dlq(), json.dumps(payload, separators=(",", ":"), default=str))
        r.ltrim(_q_dlq(), 0, 499)
    except Exception:
        pass


def queue_depths() -> dict[str, int | None]:
    r = get_sync_redis()
    if not r:
        return {"autonomous_tick": None, "autonomous_dlq": None}
    try:
        return {
            "autonomous_tick": int(r.llen(_q_main()) or 0),
            "autonomous_dlq": int(r.llen(_q_dlq()) or 0),
        }
    except Exception:
        return {"autonomous_tick": None, "autonomous_dlq": None}


def orchestration_stub_depth() -> int | None:
    """Reserved queue depth for future orchestration job fan-out."""
    r = get_sync_redis()
    if not r:
        return None
    try:
        return int(r.llen(f"{REDIS_KEY_PREFIX}:queue:orchestration:stub") or 0)
    except Exception:
        return None
