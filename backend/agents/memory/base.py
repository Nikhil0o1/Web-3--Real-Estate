"""Abstract memory / persistence for orchestration threads."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class MemoryStore(ABC):
    @abstractmethod
    def create_thread(
        self,
        *,
        user_id: int,
        wallet_address: str,
        platform_role: str,
        title: str | None,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        """Return new thread id."""

    @abstractmethod
    def append_message(
        self,
        *,
        thread_id: int,
        author: str,
        content: str,
        event_payload: dict[str, Any] | None = None,
    ) -> int:
        """Return message id."""

    @abstractmethod
    def list_threads_for_user(self, *, user_id: int, limit: int = 20) -> list[dict[str, Any]]:
        """Lightweight listing for dashboards / debugging."""

    @abstractmethod
    def list_messages(self, *, thread_id: int, limit: int = 40) -> list[dict[str, Any]]:
        """Return recent messages oldest-first for copilot / continuity."""
