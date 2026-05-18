"""Voice helpers — TTS (ElevenLabs / OpenAI) and STT (Whisper)."""
from __future__ import annotations

import logging
from typing import Tuple

import httpx

from backend.ai.config import get_settings


LOGGER = logging.getLogger(__name__)


async def synthesize_speech(text: str, voice_override: str | None = None) -> Tuple[bytes | None, str | None, str | None]:
    """Return (mp3 bytes, provider, error)."""
    settings = get_settings()
    text = (text or "").strip()
    if not text:
        return None, None, "text required"

    # ElevenLabs first when configured (better voice quality).
    if settings.elevenlabs_api_key:
        voice_id = (voice_override or "").strip() or settings.elevenlabs_voice_id
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.post(
                    url,
                    headers={
                        "xi-api-key": settings.elevenlabs_api_key,
                        "Content-Type": "application/json",
                        "Accept": "audio/mpeg",
                    },
                    json={
                        "text": text[:3800],
                        "model_id": settings.elevenlabs_model,
                        "voice_settings": {"stability": 0.45, "similarity_boost": 0.75, "style": 0.2, "use_speaker_boost": True},
                    },
                )
            if r.status_code < 400 and r.content:
                return r.content, "elevenlabs", None
            LOGGER.warning("ElevenLabs TTS failed (%s): %s", r.status_code, r.text[:200])
        except httpx.HTTPError as exc:
            LOGGER.warning("ElevenLabs TTS error: %s", exc)

    # OpenAI as fallback / primary if no ElevenLabs key.
    if settings.openai_api_key:
        voice = (voice_override or settings.openai_tts_voice or "alloy").lower()
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
            if r.status_code < 400 and r.content:
                return r.content, "openai", None
            return None, None, f"OpenAI TTS failed ({r.status_code}): {r.text[:200]}"
        except httpx.HTTPError as exc:
            return None, None, str(exc)[:200]

    return None, None, "No TTS provider configured (set ELEVENLABS_API_KEY or OPENAI_API_KEY)."


async def transcribe_audio(filename: str, content_type: str, content: bytes) -> Tuple[str | None, str | None]:
    """Return (transcribed_text, error).

    ElevenLabs Scribe API is used first when configured (best quality).
    Falls back to OpenAI Whisper otherwise.
    """
    settings = get_settings()

    # ElevenLabs Scribe API (primary)
    if settings.elevenlabs_api_key:
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                r = await client.post(
                    "https://api.elevenlabs.io/v1/speech-to-text",
                    headers={"xi-api-key": settings.elevenlabs_api_key},
                    data={"model_id": settings.elevenlabs_model or "scribe_v1"},
                    files={"file": (filename or "speech.webm", content, content_type or "application/octet-stream")},
                )
            if r.status_code < 400:
                payload = r.json()
                text = str(payload.get("text") or "").strip()
                if text:
                    return text, None
            LOGGER.warning("ElevenLabs STT failed (%s): %s", r.status_code, r.text[:200])
        except httpx.HTTPError as exc:
            LOGGER.warning("ElevenLabs STT error: %s", exc)

    # OpenAI Whisper fallback
    if not settings.openai_api_key:
        return None, "No STT provider configured (set ELEVENLABS_API_KEY or OPENAI_API_KEY)."
    data: dict[str, str] = {"model": settings.whisper_model}
    lang = (settings.whisper_language or "").lower()
    if lang and lang not in ("auto", "detect"):
        data["language"] = lang[:16]
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                f"{settings.openai_base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                files={"file": (filename or "speech.webm", content, content_type or "application/octet-stream")},
                data=data,
            )
    except httpx.HTTPError as exc:
        return None, str(exc)[:200]
    if r.status_code >= 400:
        return None, (r.text or r.reason_phrase)[:300]
    payload = r.json()
    return str(payload.get("text") or "").strip(), None
