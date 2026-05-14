"""Background asyncio loop for autonomous monitoring (optional in web process)."""
from __future__ import annotations

import asyncio
import logging

from backend.agents.autonomous.runner import run_autonomous_tick
from backend.config.settings import AUTONOMOUS_AGENT_TICK_S
from backend.agents.governance.store import get_autonomous_tick_seconds
from backend.infra.queues import autonomous_queue_dispatch_enabled, enqueue_autonomous_tick

_LOG = logging.getLogger(__name__)
_task: asyncio.Task | None = None


async def run_inline_autonomous_forever() -> None:
    """Classic single-process loop (executes ticks in-process)."""
    while True:
        try:
            summary = await run_autonomous_tick()
            _LOG.info("autonomous_tick %s", summary)
        except asyncio.CancelledError:
            raise
        except Exception:
            _LOG.exception("autonomous_tick error")
        try:
            await asyncio.sleep(max(30.0, get_autonomous_tick_seconds(float(AUTONOMOUS_AGENT_TICK_S))))
        except asyncio.CancelledError:
            raise


async def run_enqueue_autonomous_forever() -> None:
    """Web / scheduler process: push tick jobs to Redis; workers execute."""
    while True:
        try:
            if not enqueue_autonomous_tick(source="web_scheduler"):
                _LOG.warning("autonomous_tick_enqueue_failed")
        except asyncio.CancelledError:
            raise
        except Exception:
            _LOG.exception("autonomous_scheduler_enqueue_error")
        try:
            await asyncio.sleep(max(30.0, get_autonomous_tick_seconds(float(AUTONOMOUS_AGENT_TICK_S))))
        except asyncio.CancelledError:
            raise


async def autonomous_forever() -> None:
    if autonomous_queue_dispatch_enabled():
        await run_enqueue_autonomous_forever()
    else:
        await run_inline_autonomous_forever()


def start_autonomous_agents_background() -> None:
    global _task
    if _task and not _task.done():
        return
    loop = asyncio.get_running_loop()
    _task = loop.create_task(autonomous_forever(), name="autonomous_agents")
    _LOG.info(
        "Started autonomous agent background task (tick=%ss, queue_dispatch=%s).",
        AUTONOMOUS_AGENT_TICK_S,
        autonomous_queue_dispatch_enabled(),
    )


async def stop_autonomous_agents_background() -> None:
    global _task
    if not _task:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
    _LOG.info("Stopped autonomous agent background task.")
