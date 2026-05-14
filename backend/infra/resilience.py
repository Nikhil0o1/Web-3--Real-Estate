"""Lightweight Redis circuit breaker for infra calls (Phase 10)."""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable, TypeVar

_LOG = logging.getLogger(__name__)
T = TypeVar("T")


class CircuitBreaker:
    """Trip open after consecutive failures; half-open probe after cooldown."""

    def __init__(self, *, name: str, fail_max: int = 5, reset_timeout_s: float = 30.0) -> None:
        self._name = name
        self._fail_max = max(1, fail_max)
        self._reset_timeout_s = reset_timeout_s
        self._lock = threading.Lock()
        self._failures = 0
        self._opened_at: float | None = None

    def call(self, fn: Callable[[], T], default: T | None = None) -> T | None:
        with self._lock:
            if self._opened_at is not None:
                if time.monotonic() - self._opened_at < self._reset_timeout_s:
                    return default
                self._opened_at = None
                self._failures = 0
        try:
            out = fn()
        except Exception as exc:  # noqa: BLE001
            with self._lock:
                self._failures += 1
                if self._failures >= self._fail_max:
                    self._opened_at = time.monotonic()
                    _LOG.warning("circuit_open name=%s err=%s", self._name, exc)
            return default
        with self._lock:
            self._failures = 0
            self._opened_at = None
        return out


redis_breaker = CircuitBreaker(name="redis", fail_max=5, reset_timeout_s=25.0)
