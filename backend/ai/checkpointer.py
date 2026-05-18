"""Postgres checkpointer for LangGraph state persistence."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from backend.config.settings import get_database_url

LOGGER = logging.getLogger(__name__)

_POOL: object | None = None
_SETUP_FAILED: bool = False  # prevents repeated retries on a broken DB


def _build_pool():
    """Build a psycopg3 async connection pool from DATABASE_URL."""
    import psycopg_pool  # noqa: auto-import
    url = get_database_url()
    return psycopg_pool.AsyncConnectionPool(conninfo=url, max_size=10, open=False)


async def setup_checkpointer():
    """Create and setup the AsyncPostgresSaver with table migrations.

    Call once at startup (e.g. inside FastAPI lifespan or on first use).
    Returns the saver, or None if the database is unavailable.
    """
    global _POOL, _SETUP_FAILED
    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # noqa: PLC0415
        if _POOL is None:
            _POOL = _build_pool()
            await asyncio.wait_for(_POOL.open(), timeout=10.0)
        saver = AsyncPostgresSaver(_POOL)
        await asyncio.wait_for(saver.setup(), timeout=10.0)
        LOGGER.info("LangGraph Async Postgres checkpointer ready.")
        _SETUP_FAILED = False
        return saver
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("LangGraph checkpointer setup failed (conversations won't persist): %s", exc)
        _POOL = None
        _SETUP_FAILED = True
        return None


async def get_saver():
    """Return the singleton AsyncPostgresSaver, or None if the database is unavailable.

    Never raises — callers should handle None and skip checkpointing.
    """
    global _POOL, _SETUP_FAILED
    if _SETUP_FAILED:
        return None
    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver  # noqa: PLC0415
        if _POOL is None:
            return await setup_checkpointer()
        return AsyncPostgresSaver(_POOL)
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("get_saver() failed: %s", exc)
        return None


async def close_checkpointer() -> None:
    """Close the pool on shutdown."""
    global _POOL
    if _POOL is not None:
        await _POOL.close()
        _POOL = None
        LOGGER.info("LangGraph Postgres checkpointer pool closed.")


@asynccontextmanager
async def checkpointer_context() -> AsyncGenerator:
    """Context manager for a checkpointer — use in endpoints."""
    saver = await get_saver()
    try:
        yield saver
    finally:
        pass
