"""Environment-driven AI runtime settings (OpenAI-only)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _env(name: str, default: str = "") -> str:
    raw = os.getenv(name)
    return raw.strip() if raw is not None else default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class AISettings:
    enabled: bool
    # LLM
    openai_api_key: str
    openai_base_url: str
    chat_model: str
    temperature: float
    max_tool_rounds: int
    max_output_tokens: int
    # Voice (OpenAI-only)
    openai_tts_model: str
    openai_tts_voice: str
    whisper_model: str
    whisper_language: str
    # Observability
    langsmith_api_key: str
    langsmith_project: str
    langsmith_tracing: bool


@lru_cache
def get_settings() -> AISettings:
    openai_key = _env("OPENAI_API_KEY")
    return AISettings(
        enabled=_env_bool("AI_ENABLED", True) and bool(openai_key),
        openai_api_key=openai_key,
        openai_base_url=_env("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        chat_model=_env("AI_CHAT_MODEL", "gpt-4o-mini"),
        temperature=float(_env("AI_TEMPERATURE", "0.3") or 0.3),
        max_tool_rounds=int(_env("AI_MAX_TOOL_ROUNDS", "6") or 6),
        max_output_tokens=int(_env("AI_MAX_OUTPUT_TOKENS", "800") or 800),
        openai_tts_model=_env("AI_TTS_MODEL", "gpt-4o-mini-tts"),
        openai_tts_voice=_env("AI_TTS_VOICE", "alloy"),
        whisper_model=_env("AI_WHISPER_MODEL", "whisper-1"),
        whisper_language=_env("AI_WHISPER_LANGUAGE", "en"),
        langsmith_api_key=_env("LANGSMITH_API_KEY"),
        langsmith_project=_env("LANGSMITH_PROJECT", "estatechain-ai"),
        langsmith_tracing=_env_bool("LANGSMITH_TRACING", default=False),
    )
