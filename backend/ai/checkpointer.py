"""Postgres checkpointer for LangGraph state persistence."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from langgraph.checkpoint.postgres import PostgresSaver

from backend.config.settings import get_database_url

LOGGER = logging.getLogger(__name__)

_POOL: object | None = None


def _build_pool():
    """Build a psycopg3 async connection pool from DATABASE_URL."""
    import psycopg_pool  # noqa: auto-import
    url = get_database_url()
    return psycopg_pool.AsyncConnectionPool(conninfo=url, max_size=10, open=False)


async def setup_checkpointer() -> PostgresSaver:
    """Create and setup the PostgresSaver with table migrations.

    Call once at startup (e.g. inside FastAPI lifespan or on first use).
    """
    global _POOL
    if _POOL is None:
        _POOL = _build_pool()
        await _POOL.open()
    saver = PostgresSaver(_POOL, allowed_objects="core")
    await saver.setup()
    LOGGER.info("LangGraph Postgres checkpointer ready.")
    return saver


async def get_saver() -> PostgresSaver:
    """Return the singleton PostgresSaver, creating it if needed."""
    global _POOL
    if _POOL is None:
        return await setup_checkpointer()
    return PostgresSaver(_POOL, allowed_objects="core")


async def close_checkpointer() -> None:
    """Close the pool on shutdown."""
    global _POOL
    if _POOL is not None:
        await _POOL.close()
        _POOL = None
        LOGGER.info("LangGraph Postgres checkpointer pool closed.")


@asynccontextmanager
async def checkpointer_context() -> AsyncGenerator[PostgresSaver, None]:
    """Context manager for a checkpointer — use in endpoints."""
    saver = await get_saver()
    try:
        yield saver
    finally:
        pass
