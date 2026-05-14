"""Typed streaming events (SSE / future WebSocket payloads)."""
from __future__ import annotations

from typing import Any

StreamEvent = dict[str, Any]
