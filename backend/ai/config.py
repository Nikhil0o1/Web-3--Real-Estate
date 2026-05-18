"""Environment-driven AI runtime settings."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _env(name: str, default: str = "") -> str:
    raw = os.getenv(name)
    return raw.strip() if raw is not None else default


def _env_first(*names: str, default: str = "") -> str:
    for name in names:
        v = os.getenv(name)
        if v and v.strip():
            return v.strip()
    return default


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
    # Voice
    tts_provider: str  # "elevenlabs" | "openai" | "off"
    elevenlabs_api_key: str
    elevenlabs_voice_id: str
    elevenlabs_model: str
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
    eleven_key = _env_first("ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY")
    openai_key = _env("OPENAI_API_KEY")
    if eleven_key:
        provider = "elevenlabs"
    elif openai_key:
        provider = "openai"
    else:
        provider = "off"
    return AISettings(
        enabled=_env_bool("AI_ENABLED", True) and bool(openai_key),
        openai_api_key=openai_key,
        openai_base_url=_env("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
        chat_model=_env("AI_CHAT_MODEL", "gpt-4o-mini"),
        temperature=float(_env("AI_TEMPERATURE", "0.3") or 0.3),
        max_tool_rounds=int(_env("AI_MAX_TOOL_ROUNDS", "6") or 6),
        max_output_tokens=int(_env("AI_MAX_OUTPUT_TOKENS", "800") or 800),
        tts_provider=_env("AI_TTS_PROVIDER", provider).lower(),
        elevenlabs_api_key=eleven_key,
        elevenlabs_voice_id=_env_first("ELEVENLABS_VOICE_ID", "ELEVEN_LABS_VOICE_ID", default="21m00Tcm4TlvDq8ikWAM"),
        elevenlabs_model=_env_first("ELEVENLABS_MODEL", "ELEVEN_LABS_MODEL", default="eleven_turbo_v2_5"),
        openai_tts_model=_env("AI_TTS_MODEL", "gpt-4o-mini-tts"),
        openai_tts_voice=_env("AI_TTS_VOICE", "alloy"),
        whisper_model=_env("AI_WHISPER_MODEL", "whisper-1"),
        whisper_language=_env("AI_WHISPER_LANGUAGE", "en"),
        langsmith_api_key=_env("LANGSMITH_API_KEY"),
        langsmith_project=_env("LANGSMITH_PROJECT", "estatechain-ai"),
        langsmith_tracing=_env_bool("LANGSMITH_TRACING", default=False),
    )
