"""AI governance — prompt hygiene, JSON validation, and bounded context size."""
from __future__ import annotations

import json
import re
from typing import Any

_MAX_USER_MESSAGE_CHARS = 8000
_FORBIDDEN_USER_PATTERNS = (
    r"ignore\s+(all\s+)?(previous|prior)\s+instructions",
    r"system\s*:\s*",
    r"<\|im_start\|>",
)


def sanitize_user_message(text: str, *, max_chars: int = _MAX_USER_MESSAGE_CHARS) -> str:
    t = (text or "").strip()
    if len(t) > max_chars:
        t = t[:max_chars] + "…"
    for pat in _FORBIDDEN_USER_PATTERNS:
        t = re.sub(pat, "[redacted]", t, flags=re.IGNORECASE)
    return t


def trim_jsonable_facts(obj: Any, *, max_chars: int) -> str:
    """Serialize facts with a hard size cap (orchestration-safe)."""
    try:
        raw = json.dumps(obj, default=str, separators=(",", ":"))
    except Exception:  # noqa: BLE001
        return "{}"
    if len(raw) <= max_chars:
        return raw
    excerpt = raw[: max(0, max_chars - 120)]
    return json.dumps(
        {"_facts_excerpt": excerpt, "_truncated": True},
        separators=(",", ":"),
    )


def extract_json_object(text: str) -> dict[str, Any] | None:
    """Parse a JSON object from model output (handles optional ``` fences)."""
    t = (text or "").strip()
    if "```" in t:
        m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", t, re.DOTALL)
        if m:
            t = m.group(1).strip()
    try:
        out = json.loads(t)
    except json.JSONDecodeError:
        return None
    return out if isinstance(out, dict) else None


def validate_copilot_synthesis_payload(data: dict[str, Any]) -> tuple[str, str] | None:
    """Return (message, reasoning_summary) if valid."""
    msg = data.get("message")
    reason = data.get("reasoning_summary")
    if not isinstance(msg, str) or not isinstance(reason, str):
        return None
    msg = msg.strip()
    reason = reason.strip()
    if not msg:
        return None
    if len(msg) > 12000:
        msg = msg[:12000] + "…"
    if len(reason) > 8000:
        reason = reason[:8000] + "…"
    return msg, reason
