"""Centralized prompt keys for future LLM turns (Phase 1: placeholders only)."""
from __future__ import annotations

_PROMPTS: dict[str, str] = {
    "foundation.system": (
        "You are the EstateChain orchestration layer. "
        "Do not sign transactions or request private keys. "
        "Domain tools will be attached in later phases."
    ),
}


def get_system_prompt(key: str) -> str:
    return _PROMPTS.get(key, "")
