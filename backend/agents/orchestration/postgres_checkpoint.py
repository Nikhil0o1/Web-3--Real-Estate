"""LangGraph checkpoint persistence in PostgreSQL via psycopg2 (no psycopg3 / libpq).

Mirrors the semantics of ``langgraph.checkpoint.sqlite.SqliteSaver`` for compatibility
with pinned ``langgraph`` 0.2.x while remaining deployable on Windows stacks that
already use ``psycopg2-binary``.
"""
from __future__ import annotations

import json
import random
import threading
from collections.abc import AsyncIterator, Iterator, Sequence
from contextlib import contextmanager
from typing import Any, cast

from langchain_core.runnables import RunnableConfig
from psycopg2 import connect

from langgraph.checkpoint.base import (
    WRITES_IDX_MAP,
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
    SerializerProtocol,
    get_checkpoint_id,
    get_checkpoint_metadata,
)
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

from backend.config.settings import get_database_url


def _search_where_pg(
    config: RunnableConfig | None,
    filter: dict[str, Any] | None,
    before: RunnableConfig | None = None,
) -> tuple[str, list[Any]]:
    """Postgres variant of ``search_where`` (placeholders ``%s``)."""
    wheres: list[str] = []
    param_values: list[Any] = []

    if config is not None:
        wheres.append("thread_id = %s")
        param_values.append(config["configurable"]["thread_id"])
        checkpoint_ns = config["configurable"].get("checkpoint_ns")
        if checkpoint_ns is not None:
            wheres.append("checkpoint_ns = %s")
            param_values.append(checkpoint_ns)

        if checkpoint_id := get_checkpoint_id(config):
            wheres.append("checkpoint_id = %s")
            param_values.append(checkpoint_id)

    if filter:
        for query_key, query_value in filter.items():
            if query_value is None:
                wheres.append(f"(metadata::jsonb -> %s) IS NULL")
                param_values.append(query_key)
            elif isinstance(query_value, bool):
                wheres.append(f"(metadata::jsonb ->> %s) = %s")
                param_values.extend([query_key, "true" if query_value else "false"])
            elif isinstance(query_value, (str, int, float)):
                wheres.append(f"(metadata::jsonb ->> %s) = %s")
                param_values.extend([query_key, str(query_value)])
            elif isinstance(query_value, (dict, list)):
                wheres.append("metadata::jsonb @> %s::jsonb")
                param_values.append(json.dumps({query_key: query_value}, separators=(",", ":")))
            else:
                wheres.append(f"(metadata::jsonb ->> %s) = %s")
                param_values.extend([query_key, str(query_value)])

    if before is not None:
        wheres.append("checkpoint_id < %s")
        param_values.append(get_checkpoint_id(before))

    return ("WHERE " + " AND ".join(wheres) if wheres else "", param_values)


class PostgresCheckpointSaver(BaseCheckpointSaver[str]):
    """Thread-safe synchronous checkpoint saver backed by PostgreSQL."""

    def __init__(self, *, serde: SerializerProtocol | None = None) -> None:
        super().__init__(serde=serde)
        self.jsonplus_serde = JsonPlusSerializer()
        self._lock = threading.Lock()
        self._setup_done = False

    def _conn(self):
        return connect(get_database_url())

    def setup(self, cur) -> None:
        if self._setup_done:
            return
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_lg_checkpoints (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                parent_checkpoint_id TEXT,
                type TEXT,
                checkpoint BYTEA NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_lg_writes (
                thread_id TEXT NOT NULL,
                checkpoint_ns TEXT NOT NULL DEFAULT '',
                checkpoint_id TEXT NOT NULL,
                task_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                channel TEXT NOT NULL,
                type TEXT,
                value BYTEA,
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
            )
            """
        )
        self._setup_done = True

    @contextmanager
    def _cursor(self, *, transaction: bool = True):
        with self._lock:
            conn = self._conn()
            try:
                cur = conn.cursor()
                try:
                    self.setup(cur)
                    yield cur
                finally:
                    cur.close()
                if transaction:
                    conn.commit()
            finally:
                conn.close()

    def get_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        checkpoint_ns = config["configurable"].get("checkpoint_ns", "")
        with self._cursor(transaction=False) as cur:
            if checkpoint_id := get_checkpoint_id(config):
                cur.execute(
                    "SELECT thread_id, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata "
                    "FROM agent_lg_checkpoints WHERE thread_id = %s AND checkpoint_ns = %s AND checkpoint_id = %s",
                    (
                        str(config["configurable"]["thread_id"]),
                        checkpoint_ns,
                        checkpoint_id,
                    ),
                )
            else:
                cur.execute(
                    "SELECT thread_id, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata "
                    "FROM agent_lg_checkpoints WHERE thread_id = %s AND checkpoint_ns = %s "
                    "ORDER BY checkpoint_id DESC LIMIT 1",
                    (str(config["configurable"]["thread_id"]), checkpoint_ns),
                )
            value = cur.fetchone()
            if not value:
                return None
            thread_id, checkpoint_id, parent_checkpoint_id, type_, checkpoint, metadata = value
            if not get_checkpoint_id(config):
                config = {
                    "configurable": {
                        "thread_id": thread_id,
                        "checkpoint_ns": checkpoint_ns,
                        "checkpoint_id": checkpoint_id,
                    }
                }
            cur.execute(
                "SELECT task_id, channel, type, value FROM agent_lg_writes "
                "WHERE thread_id = %s AND checkpoint_ns = %s AND checkpoint_id = %s ORDER BY task_id, idx",
                (
                    str(config["configurable"]["thread_id"]),
                    checkpoint_ns,
                    str(config["configurable"]["checkpoint_id"]),
                ),
            )
            meta_obj: CheckpointMetadata
            if metadata is None:
                meta_obj = {}
            elif isinstance(metadata, (dict, list)):
                meta_obj = cast(CheckpointMetadata, metadata)
            else:
                meta_obj = cast(CheckpointMetadata, self.jsonplus_serde.loads(metadata))

            return CheckpointTuple(
                config,
                self.serde.loads_typed((type_, checkpoint)),
                meta_obj,
                (
                    {
                        "configurable": {
                            "thread_id": thread_id,
                            "checkpoint_ns": checkpoint_ns,
                            "checkpoint_id": parent_checkpoint_id,
                        }
                    }
                    if parent_checkpoint_id
                    else None
                ),
                [(task_id, channel, self.serde.loads_typed((t, v))) for task_id, channel, t, v in cur.fetchall()],
            )

    def list(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        where_pg, param_values = _search_where_pg(config, filter, before)
        query = (
            "SELECT thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata "
            "FROM agent_lg_checkpoints "
            f"{where_pg} ORDER BY checkpoint_id DESC"
        )
        if limit:
            query += f" LIMIT {int(limit)}"
        with self._cursor(transaction=False) as cur:
            cur.execute(query, param_values)
            rows = cur.fetchall()
            for (
                thread_id,
                checkpoint_ns,
                checkpoint_id,
                parent_checkpoint_id,
                type_,
                checkpoint,
                metadata,
            ) in rows:
                cur.execute(
                    "SELECT task_id, channel, type, value FROM agent_lg_writes "
                    "WHERE thread_id = %s AND checkpoint_ns = %s AND checkpoint_id = %s ORDER BY task_id, idx",
                    (thread_id, checkpoint_ns, checkpoint_id),
                )
                write_rows = cur.fetchall()
                if isinstance(metadata, dict):
                    meta_obj = cast(CheckpointMetadata, metadata)
                else:
                    meta_obj = cast(
                        CheckpointMetadata,
                        self.jsonplus_serde.loads(metadata) if metadata is not None else {},
                    )
                yield CheckpointTuple(
                    {
                        "configurable": {
                            "thread_id": thread_id,
                            "checkpoint_ns": checkpoint_ns,
                            "checkpoint_id": checkpoint_id,
                        }
                    },
                    self.serde.loads_typed((type_, checkpoint)),
                    meta_obj,
                    (
                        {
                            "configurable": {
                                "thread_id": thread_id,
                                "checkpoint_ns": checkpoint_ns,
                                "checkpoint_id": parent_checkpoint_id,
                            }
                        }
                        if parent_checkpoint_id
                        else None
                    ),
                    [(task_id, channel, self.serde.loads_typed((t, v))) for task_id, channel, t, v in write_rows],
                )

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        _ = new_versions
        thread_id = config["configurable"]["thread_id"]
        checkpoint_ns = config["configurable"]["checkpoint_ns"]
        type_, serialized_checkpoint = self.serde.dumps_typed(checkpoint)
        serialized_metadata = self.jsonplus_serde.dumps(get_checkpoint_metadata(config, metadata))
        try:
            meta_json = json.loads(serialized_metadata.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            meta_json = {}
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO agent_lg_checkpoints (
                    thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
                ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET
                    parent_checkpoint_id = EXCLUDED.parent_checkpoint_id,
                    type = EXCLUDED.type,
                    checkpoint = EXCLUDED.checkpoint,
                    metadata = EXCLUDED.metadata
                """,
                (
                    str(config["configurable"]["thread_id"]),
                    checkpoint_ns,
                    checkpoint["id"],
                    config["configurable"].get("checkpoint_id"),
                    type_,
                    serialized_checkpoint,
                    json.dumps(meta_json, separators=(",", ":")),
                ),
            )
        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
                "checkpoint_id": checkpoint["id"],
            }
        }

    def put_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        _ = task_path
        use_replace = all(w[0] in WRITES_IDX_MAP for w in writes)
        if use_replace:
            sql = (
                "INSERT INTO agent_lg_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id, task_id, idx) DO UPDATE SET "
                "channel = EXCLUDED.channel, type = EXCLUDED.type, value = EXCLUDED.value"
            )
        else:
            sql = (
                "INSERT INTO agent_lg_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
                "ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id, task_id, idx) DO NOTHING"
            )
        rows = [
            (
                str(config["configurable"]["thread_id"]),
                str(config["configurable"]["checkpoint_ns"]),
                str(config["configurable"]["checkpoint_id"]),
                task_id,
                WRITES_IDX_MAP.get(channel, idx),
                channel,
                *self.serde.dumps_typed(value),
            )
            for idx, (channel, value) in enumerate(writes)
        ]
        with self._cursor() as cur:
            cur.executemany(sql, rows)

    def delete_thread(self, thread_id: str) -> None:
        with self._cursor() as cur:
            cur.execute("DELETE FROM agent_lg_checkpoints WHERE thread_id = %s", (str(thread_id),))
            cur.execute("DELETE FROM agent_lg_writes WHERE thread_id = %s", (str(thread_id),))

    def get_next_version(self, current: str | None, channel: None) -> str:
        if current is None:
            current_v = 0
        elif isinstance(current, int):
            current_v = current
        else:
            current_v = int(str(current).split(".")[0])
        next_v = current_v + 1
        next_h = random.random()
        return f"{next_v:032}.{next_h:016}"

    async def aget_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        raise NotImplementedError("Use synchronous get_tuple with PostgresCheckpointSaver")

    async def alist(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[CheckpointTuple]:
        raise NotImplementedError("Use synchronous list")
        yield  # pragma: no cover

    async def aput(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        raise NotImplementedError("Use synchronous put")
