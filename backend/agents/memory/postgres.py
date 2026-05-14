"""PostgreSQL-backed thread + message persistence (psycopg2, same stack as the API)."""
from __future__ import annotations

import json
from typing import Any

from backend.agents.memory.base import MemoryStore
from backend.infra.memory_cache import get_cached_thread_list, invalidate_thread_list_cache, set_cached_thread_list


class PostgresAgentMemoryStore(MemoryStore):
    def __init__(self, db_conn) -> None:
        self._db = db_conn

    def create_thread(
        self,
        *,
        user_id: int,
        wallet_address: str,
        platform_role: str,
        title: str | None,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        cur = self._db.cursor()
        try:
            meta_json = json.dumps(metadata or {})
            cur.execute(
                """
                INSERT INTO agent_orchestration_threads
                    (user_id, wallet_address, platform_role, title, metadata)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (user_id, wallet_address.lower(), platform_role, title, meta_json),
            )
            row = cur.fetchone()
            self._db.commit()
            tid = int(row[0])
            try:
                invalidate_thread_list_cache(user_id=user_id)
            except Exception:
                pass
            return tid
        except Exception:
            self._db.rollback()
            raise
        finally:
            cur.close()

    def append_message(
        self,
        *,
        thread_id: int,
        author: str,
        content: str,
        event_payload: dict[str, Any] | None = None,
    ) -> int:
        cur = self._db.cursor()
        try:
            cur.execute("SELECT user_id FROM agent_orchestration_threads WHERE id = %s", (thread_id,))
            urow = cur.fetchone()
            owner_id = int(urow[0]) if urow else None
            cur.execute(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_orchestration_messages WHERE thread_id = %s",
                (thread_id,),
            )
            seq = int(cur.fetchone()[0])
            payload = json.dumps(event_payload or {})
            cur.execute(
                """
                INSERT INTO agent_orchestration_messages
                    (thread_id, author, content, event_payload, seq)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (thread_id, author, content, payload, seq),
            )
            msg_id = int(cur.fetchone()[0])
            cur.execute(
                "UPDATE agent_orchestration_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                (thread_id,),
            )
            self._db.commit()
            if owner_id is not None:
                try:
                    invalidate_thread_list_cache(user_id=owner_id)
                except Exception:
                    pass
            return msg_id
        except Exception:
            self._db.rollback()
            raise
        finally:
            cur.close()

    def list_messages(self, *, thread_id: int, limit: int = 40) -> list[dict[str, Any]]:
        lim = max(1, min(int(limit), 200))
        cur = self._db.cursor(dictionary=True)
        try:
            cur.execute(
                """
                SELECT author, content, event_payload, seq
                FROM agent_orchestration_messages
                WHERE thread_id = %s
                ORDER BY seq DESC
                LIMIT %s
                """,
                (thread_id, lim),
            )
            rows = list(reversed(cur.fetchall() or []))
            out: list[dict[str, Any]] = []
            for r in rows:
                ep = r.get("event_payload")
                if isinstance(ep, str):
                    try:
                        ep = json.loads(ep)
                    except json.JSONDecodeError:
                        ep = {}
                out.append(
                    {
                        "author": r.get("author"),
                        "content": r.get("content"),
                        "seq": int(r.get("seq") or 0),
                        "event_payload": ep if isinstance(ep, dict) else {},
                    }
                )
            return out
        finally:
            cur.close()

    def list_threads_for_user(self, *, user_id: int, limit: int = 20) -> list[dict[str, Any]]:
        cached = get_cached_thread_list(user_id=user_id, limit=limit)
        if cached is not None:
            return cached
        cur = self._db.cursor()
        try:
            cur.execute(
                """
                SELECT t.id, t.title, t.created_at,
                       (SELECT COUNT(*) FROM agent_orchestration_messages m WHERE m.thread_id = t.id) AS mc
                FROM agent_orchestration_threads t
                WHERE t.user_id = %s
                ORDER BY t.updated_at DESC
                LIMIT %s
                """,
                (user_id, limit),
            )
            rows = cur.fetchall()
            out = [
                {"id": int(r[0]), "title": r[1], "created_at": r[2], "message_count": int(r[3] or 0)}
                for r in rows
            ]
            try:
                set_cached_thread_list(user_id=user_id, limit=limit, rows=out)
            except Exception:
                pass
            return out
        finally:
            cur.close()

    def upsert_context_kv(self, *, user_id: int, namespace: str, key: str, value: str) -> None:
        """Key/value preferences or long-lived hints (future copilots)."""
        cur = self._db.cursor()
        try:
            cur.execute(
                """
                INSERT INTO agent_context_kv (user_id, namespace, key, value, updated_at)
                VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id, namespace, key)
                DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
                """,
                (user_id, namespace[:64], key[:128], value),
            )
            self._db.commit()
        except Exception:
            self._db.rollback()
            raise
        finally:
            cur.close()
