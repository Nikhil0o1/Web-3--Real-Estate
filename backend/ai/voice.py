"""ElevenLabs voice helpers — Scribe STT + Multilingual TTS.

Kept minimal on purpose: two functions, both pure HTTP calls to ElevenLabs.
No WebSockets, no streaming-input TTS, no realtime token issuing — the
chat endpoint already streams text tokens, and we synthesize the final
sentence-by-sentence reply once it's complete.
"""
from __future__ import annotations

import logging
from typing import Tuple

import httpx

from backend.ai.config import get_settings

LOGGER = logging.getLogger(__name__)


_VOICE_SETTINGS = {
    "stability": 0.5,
    "similarity_boost": 0.8,
    "style": 0.15,
    "use_speaker_boost": True,
}


async def synthesize_speech(text: str, voice_override: str | None = None) -> Tuple[bytes | None, str | None]:
    """Return ``(mp3_bytes, error)``. Uses ElevenLabs multilingual TTS."""
    settings = get_settings()
    text = (text or "").strip()
    if not text:
        return None, "text required"
    if not settings.elevenlabs_api_key:
        return None, "ELEVENLABS_API_KEY is not set on the server."

    voice_id = (voice_override or "").strip() or settings.elevenlabs_voice_id
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
    payload = {
        "text": text[:3800],
        "model_id": settings.elevenlabs_model,
        "voice_settings": _VOICE_SETTINGS,
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                url,
                headers={
                    "xi-api-key": settings.elevenlabs_api_key,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        LOGGER.warning("ElevenLabs TTS error: %s", exc)
        return None, str(exc)[:200]

    if r.status_code < 400 and r.content:
        return r.content, None

    detail = (r.text or "")[:300]
    LOGGER.warning("ElevenLabs TTS failed (%s): %s", r.status_code, detail)
    return None, f"ElevenLabs TTS failed ({r.status_code}): {detail}"


async def transcribe_audio(
    filename: str,
    content_type: str,
    content: bytes,
) -> Tuple[str | None, str | None]:
    """Return ``(text, error)``. Uses ElevenLabs Scribe STT.

    Scribe handles noise filtering and language detection on its own. We force
    English so accented speech can't drift into another script.
    """
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        return None, "ELEVENLABS_API_KEY is not set on the server."
    if not content:
        return None, "empty audio payload"

    lang = (settings.elevenlabs_stt_language or "en").strip().lower()
    if lang in {"", "auto", "detect"}:
        lang = "en"

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                "https://api.elevenlabs.io/v1/speech-to-text",
                headers={"xi-api-key": settings.elevenlabs_api_key},
                data={
                    "model_id": settings.elevenlabs_stt_model or "scribe_v1",
                    "language_code": lang,
                },
                files={
                    "file": (
                        filename or "speech.webm",
                        content,
                        content_type or "application/octet-stream",
                    ),
                },
            )
    except httpx.HTTPError as exc:
        LOGGER.warning("ElevenLabs STT error: %s", exc)
        return None, str(exc)[:200]

    if r.status_code < 400:
        try:
            text = str((r.json() or {}).get("text") or "").strip()
            if text:
                return text, None
        except Exception:  # noqa: BLE001
            pass

    detail = (r.text or "")[:300]
    LOGGER.warning("ElevenLabs STT failed (%s): %s", r.status_code, detail)
    return None, f"ElevenLabs STT failed ({r.status_code}): {detail}"
