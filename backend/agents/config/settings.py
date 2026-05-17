"""Environment-driven AI / orchestration configuration (no secrets in code)."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_str(name: str, default: str) -> str:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip()


def _env_first(*names: str, default: str = "") -> str:
    for name in names:
        raw = os.getenv(name)
        if raw is not None and raw.strip():
            return raw.strip()
    return default


@dataclass(frozen=True)
class AISettings:
    orchestration_enabled: bool
    provider: str
    default_model: str
    request_timeout_s: float
    stream_test_delay_s: float
    openai_api_key: str
    anthropic_api_key: str
    elevenlabs_api_key: str
    elevenlabs_voice_id: str
    elevenlabs_model: str
    local_model_base_url: str
    max_tool_rounds: int
    log_graph_structure: bool
    # Phase 6 — hybrid LLM cognition (deterministic facts remain authoritative)
    ai_llm_synthesis_enabled: bool
    fallback_provider: str
    fallback_model: str
    max_llm_output_tokens: int
    llm_temperature: float
    max_facts_json_chars: int
    llm_max_retries_per_provider: int
    anthropic_default_model: str
    openai_base_url: str


@lru_cache
def get_ai_settings() -> AISettings:
    return AISettings(
        orchestration_enabled=_env_bool("AI_ORCHESTRATION_ENABLED", True),
        provider=os.getenv("AI_PROVIDER", "openai").strip().lower(),
        default_model=os.getenv("AI_DEFAULT_MODEL", "gpt-4o-mini").strip(),
        request_timeout_s=float(os.getenv("AI_REQUEST_TIMEOUT_S", "120")),
        stream_test_delay_s=float(os.getenv("AI_STREAM_TEST_DELAY_S", "0.05")),
        openai_api_key=os.getenv("OPENAI_API_KEY", "").strip(),
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", "").strip(),
        elevenlabs_api_key=_env_first("ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY"),
        # Default female voice "Rachel" — replace via ELEVENLABS_VOICE_ID.
        elevenlabs_voice_id=_env_first("ELEVENLABS_VOICE_ID", "ELEVEN_LABS_VOICE_ID", default="21m00Tcm4TlvDq8ikWAM"),
        elevenlabs_model=_env_first("ELEVENLABS_MODEL", "ELEVEN_LABS_MODEL", default="eleven_turbo_v2_5"),
        local_model_base_url=os.getenv("AI_LOCAL_MODEL_BASE_URL", "").strip().rstrip("/"),
        max_tool_rounds=int(os.getenv("AI_MAX_TOOL_ROUNDS", "8")),
        log_graph_structure=_env_bool("AI_LOG_GRAPH_STRUCTURE", False),
        ai_llm_synthesis_enabled=_env_bool("AI_LLM_SYNTHESIS_ENABLED", True),
        fallback_provider=_env_str("AI_FALLBACK_PROVIDER", "").lower(),
        fallback_model=_env_str("AI_FALLBACK_MODEL", "claude-3-5-haiku-20241022"),
        max_llm_output_tokens=int(os.getenv("AI_MAX_LLM_OUTPUT_TOKENS", "900")),
        llm_temperature=float(os.getenv("AI_LLM_TEMPERATURE", "0.2")),
        max_facts_json_chars=int(os.getenv("AI_MAX_FACTS_JSON_CHARS", "12000")),
        llm_max_retries_per_provider=int(os.getenv("AI_LLM_MAX_RETRIES_PER_PROVIDER", "2")),
        anthropic_default_model=_env_str("AI_ANTHROPIC_DEFAULT_MODEL", "claude-3-5-haiku-20241022"),
        openai_base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/"),
    )
