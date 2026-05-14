"""Standalone blockchain indexer worker.

Run with:
    python -m backend.worker

Holds a PostgreSQL advisory lock so only one instance processes events
against the database, even if orchestration accidentally starts multiple
copies. Handles SIGINT/SIGTERM for clean shutdown.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys

from backend.config.settings import LOG_LEVEL, validate_required_settings
from backend.db.schema import init_db
from backend.services.blockchain_indexer import (
    _STOP_EVENT,
    run_foreground_indexer,
)


def _install_signal_handlers() -> None:
    def _handle(signum, _frame):
        logging.getLogger(__name__).info("Received signal %s; requesting indexer stop.", signum)
        _STOP_EVENT.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handle)
        except (ValueError, AttributeError):
            # Not all signals exist on all platforms (e.g. Windows).
            pass


def main() -> int:
    logging.basicConfig(
        level=getattr(logging, LOG_LEVEL, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    log = logging.getLogger(__name__)

    if os.getenv("AUTONOMOUS_WORKER", "").lower() in ("1", "true", "yes", "on"):
        log.info("Starting autonomous monitoring worker (AUTONOMOUS_WORKER=true).")
        validate_required_settings()
        init_db()
        from backend.agents.autonomous.distributed_loop import autonomous_worker_entry

        try:
            asyncio.run(autonomous_worker_entry())
        except KeyboardInterrupt:
            return 0
        return 0

    log.info("Starting blockchain indexer worker (standalone process).")

    validate_required_settings()
    init_db()

    _install_signal_handlers()

    exit_code = run_foreground_indexer()
    log.info("Indexer worker exiting with code %s.", exit_code)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
