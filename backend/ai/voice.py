"""Voice helpers — OpenAI TTS + Whisper STT."""
from __future__ import annotations

import logging
from typing import Tuple

import httpx

from backend.ai.config import get_settings


LOGGER = logging.getLogger(__name__)

_ALLOWED_OPENAI_VOICES = {
    "alloy", "ash", "ballad", "coral", "echo",
    "fable", "nova", "onyx", "sage", "shimmer", "verse",
}


async def synthesize_speech(text: str, voice_override: str | None = None) -> Tuple[bytes | None, str | None, str | None]:
    """Return (mp3 bytes, provider, error)."""
    settings = get_settings()
    text = (text or "").strip()
    if not text:
        return None, None, "text required"

    if not settings.openai_api_key:
        return None, None, "OPENAI_API_KEY is not set on the server."

    voice = (voice_override or settings.openai_tts_voice or "alloy").strip().lower()
    if voice not in _ALLOWED_OPENAI_VOICES:
        voice = "alloy"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"{settings.openai_base_url}/audio/speech",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.openai_tts_model,
                    "voice": voice,
                    "input": text[:3800],
                    "response_format": "mp3",
                },
            )
    except httpx.HTTPError as exc:
        LOGGER.warning("OpenAI TTS error: %s", exc)
        return None, None, str(exc)[:200]

    if r.status_code >= 400 or not r.content:
        detail = (r.text or "")[:300] if r is not None else ""
        LOGGER.warning("OpenAI TTS failed (%s): %s", r.status_code, detail)
        return None, None, f"OpenAI TTS failed ({r.status_code}): {detail}"

    return r.content, "openai", None


async def transcribe_audio(filename: str, content_type: str, content: bytes) -> Tuple[str | None, str | None]:
    """Return (transcribed_text, error). Uses OpenAI Whisper."""
    settings = get_settings()
    if not settings.openai_api_key:
        return None, "OPENAI_API_KEY is not set on the server."
    if not content:
        return None, "empty audio payload"

    data: dict[str, str] = {"model": settings.whisper_model}
    lang = (settings.whisper_language or "").lower()
    if lang and lang not in ("auto", "detect"):
        data["language"] = lang[:16]

    # Whisper accepts webm/ogg/mp4/wav/mp3/m4a; pass through the browser's mime.
    safe_name = filename or "speech.webm"
    safe_type = content_type or "audio/webm"

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                f"{settings.openai_base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                files={"file": (safe_name, content, safe_type)},
                data=data,
            )
    except httpx.HTTPError as exc:
        LOGGER.warning("OpenAI Whisper error: %s", exc)
        return None, str(exc)[:200]

    if r.status_code >= 400:
        detail = (r.text or r.reason_phrase or "")[:300]
        LOGGER.warning("OpenAI Whisper failed (%s): %s", r.status_code, detail)
        return None, detail or f"Whisper failed with status {r.status_code}"

    try:
        payload = r.json()
    except Exception:  # noqa: BLE001
        return None, "Whisper returned a non-JSON response."
    return str(payload.get("text") or "").strip(), None
