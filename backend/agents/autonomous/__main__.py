"""CLI: ``python -m backend.agents.autonomous`` (same loop as web/worker background)."""
from __future__ import annotations

import asyncio
import logging
import sys

from backend.agents.autonomous.distributed_loop import autonomous_worker_entry
from backend.config.settings import LOG_LEVEL, validate_required_settings
from backend.db.schema import init_db


def main() -> int:
    logging.basicConfig(
        level=getattr(logging, LOG_LEVEL, logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    validate_required_settings()
    init_db()
    try:
        asyncio.run(autonomous_worker_entry())
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
