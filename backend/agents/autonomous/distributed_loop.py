"""Distributed autonomous runtime — Redis queue consumer (Phase 10)."""
from __future__ import annotations

import asyncio
import logging

from backend.agents.autonomous.runner import run_autonomous_tick
from backend.agents.governance.store import record_governance_event, record_metric_sample
from backend.infra.queues import (
    autonomous_queue_dispatch_enabled,
    brpop_autonomous_job,
    push_dlq,
)

_LOG = logging.getLogger(__name__)


async def autonomous_queue_consumer_forever() -> None:
    """Dedicated worker: BRPOP jobs and execute ``run_autonomous_tick`` (same runtime as web)."""
    _LOG.info("autonomous_queue_consumer_started")
    while True:
        job = await asyncio.to_thread(lambda: brpop_autonomous_job(timeout_s=5))
        if not job:
            await asyncio.sleep(0.05)
            continue
        try:
            summary = await run_autonomous_tick()
            _LOG.info("autonomous_tick_consumed job=%s summary=%s", job, summary)
            try:
                record_metric_sample(
                    metric_key="worker.autonomous.tick",
                    dimensions={"queue": "redis"},
                    value={"ok": True, "summary": summary},
                )
            except Exception:
                pass
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            _LOG.exception("autonomous_tick_job_failed job=%s", job)
            push_dlq(job, str(exc))
            try:
                record_governance_event(
                    event_type="worker.autonomous.failed",
                    severity="warning",
                    source="autonomous_worker",
                    payload={"error": str(exc)[:500], "job": job},
                )
            except Exception:
                pass


async def autonomous_worker_entry() -> None:
    """``python -m backend.worker`` with ``AUTONOMOUS_WORKER``: queue consumer or inline ticks."""
    if autonomous_queue_dispatch_enabled():
        await autonomous_queue_consumer_forever()
        return
    from backend.agents.autonomous.background import run_inline_autonomous_forever

    await run_inline_autonomous_forever()
