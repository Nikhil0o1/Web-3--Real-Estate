"""Structured logging for orchestration, tools, graphs, and streaming."""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Mapping

_AGENT_PREFIX = "agents"


def get_agent_logger(name: str) -> logging.Logger:
    """Namespaced logger, e.g. ``agents.orchestrator``."""
    clean = name.removeprefix(f"{_AGENT_PREFIX}.")
    return logging.getLogger(f"{_AGENT_PREFIX}.{clean}")


def new_trace_id() -> str:
    return str(uuid.uuid4())


def log_orchestration_event(
    logger: logging.Logger,
    event: str,
    *,
    trace_id: str | None = None,
    extra: Mapping[str, Any] | None = None,
    level: int = logging.INFO,
) -> None:
    """Single JSON-friendly log line for lifecycle / tool / stream events."""
    payload: dict[str, Any] = {"event": event, "ts": time.time()}
    if trace_id:
        payload["trace_id"] = trace_id
    if extra:
        payload["extra"] = dict(extra)
    logger.log(level, "orchestration %s", json.dumps(payload, default=str))


def log_analytics_event(
    logger: logging.Logger,
    event: str,
    *,
    trace_id: str | None = None,
    extra: Mapping[str, Any] | None = None,
    level: int = logging.INFO,
) -> None:
    """Structured analytics / intelligence logs (distinct prefix for grep)."""
    payload: dict[str, Any] = {"channel": "analytics", "event": event, "ts": time.time()}
    if trace_id:
        payload["trace_id"] = trace_id
    if extra:
        payload["extra"] = dict(extra)
    logger.log(level, "analytics %s", json.dumps(payload, default=str))
