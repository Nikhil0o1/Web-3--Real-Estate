"""Voice helpers — ElevenLabs TTS + ElevenLabs Scribe STT."""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator, Tuple

import httpx
import websockets
from websockets.client import WebSocketClientProtocol

from backend.ai.config import get_settings

LOGGER = logging.getLogger(__name__)


_VOICE_SETTINGS = {
    "stability": 0.45,
    "similarity_boost": 0.75,
    "style": 0.2,
    "use_speaker_boost": True,
}


def _speech_payload(text: str) -> dict:
    settings = get_settings()
    return {
        "text": text[:3800],
        "model_id": settings.elevenlabs_model,
        "voice_settings": _VOICE_SETTINGS,
    }


async def synthesize_speech(text: str, voice_override: str | None = None) -> Tuple[bytes | None, str | None, str | None]:
    """Return (mp3 bytes, provider, error). Uses ElevenLabs TTS."""
    settings = get_settings()
    text = (text or "").strip()
    if not text:
        return None, None, "text required"

    if not settings.elevenlabs_api_key:
        return None, None, "ELEVENLABS_API_KEY is not set on the server."

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
                json=_speech_payload(text),
            )
    except httpx.HTTPError as exc:
        LOGGER.warning("ElevenLabs TTS error: %s", exc)
        return None, None, str(exc)[:200]

    if r.status_code < 400 and r.content:
        return r.content, "elevenlabs", None

    detail = (r.text or "")[:300]
    LOGGER.warning("ElevenLabs TTS failed (%s): %s", r.status_code, detail)
    return None, None, f"ElevenLabs TTS failed ({r.status_code}): {detail}"


async def stream_speech(
    text: str,
    voice_override: str | None = None,
) -> AsyncIterator[bytes]:
    """Yield ElevenLabs MP3 bytes as they are generated."""
    settings = get_settings()
    text = (text or "").strip()
    if not text:
        raise ValueError("text required")
    if not settings.elevenlabs_api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set on the server.")

    voice_id = (voice_override or "").strip() or settings.elevenlabs_voice_id
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                url,
                headers={
                    "xi-api-key": settings.elevenlabs_api_key,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg",
                },
                json=_speech_payload(text),
            ) as r:
                if r.status_code >= 400:
                    detail = (await r.aread()).decode("utf-8", errors="ignore")[:300]
                    LOGGER.warning("ElevenLabs streaming TTS failed (%s): %s", r.status_code, detail)
                    raise RuntimeError(f"ElevenLabs TTS failed ({r.status_code}): {detail}")
                async for chunk in r.aiter_bytes():
                    if chunk:
                        yield chunk
    except httpx.HTTPError as exc:
        LOGGER.warning("ElevenLabs streaming TTS error: %s", exc)
        raise RuntimeError(str(exc)[:200]) from exc


async def open_speech_stream(
    text: str,
    voice_override: str | None = None,
) -> Tuple[httpx.AsyncClient | None, httpx.Response | None, str | None]:
    """Open an ElevenLabs streaming TTS response so routes can fail before sending headers."""
    settings = get_settings()
    text = (text or "").strip()
    if not text:
        return None, None, "text required"
    if not settings.elevenlabs_api_key:
        return None, None, "ELEVENLABS_API_KEY is not set on the server."

    voice_id = (voice_override or "").strip() or settings.elevenlabs_voice_id
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128"
    client = httpx.AsyncClient(timeout=60.0)
    try:
        request = client.build_request(
            "POST",
            url,
            headers={
                "xi-api-key": settings.elevenlabs_api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            json=_speech_payload(text),
        )
        response = await client.send(request, stream=True)
        if response.status_code >= 400:
            detail = (await response.aread()).decode("utf-8", errors="ignore")[:300]
            await response.aclose()
            await client.aclose()
            LOGGER.warning("ElevenLabs streaming TTS failed (%s): %s", response.status_code, detail)
            return None, None, f"ElevenLabs TTS failed ({response.status_code}): {detail}"
        return client, response, None
    except httpx.HTTPError as exc:
        await client.aclose()
        LOGGER.warning("ElevenLabs streaming TTS error: %s", exc)
        return None, None, str(exc)[:200]


def _ws_tts_url(voice_id: str, output_format: str = "pcm_16000") -> str:
    model_id = get_settings().elevenlabs_model
    return (
        f"wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input"
        f"?model_id={model_id}"
        f"&output_format={output_format}"
        f"&auto_mode=true"
    )


@asynccontextmanager
async def open_tts_websocket(
    voice_override: str | None = None,
    output_format: str = "pcm_16000",
) -> AsyncIterator[WebSocketClientProtocol]:
    """Open an ElevenLabs streaming-input TTS WebSocket and send the BOS init frame.

    Caller pushes ``{"text": "..."}`` frames as LLM tokens arrive, then
    ``{"text": "", "flush": true}`` to signal the end of the utterance. The
    server yields ``{"audio": "<base64>", "isFinal": bool}`` messages with PCM
    audio chunks.
    """
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set on the server.")

    voice_id = (voice_override or "").strip() or settings.elevenlabs_voice_id
    url = _ws_tts_url(voice_id, output_format)

    headers = {"xi-api-key": settings.elevenlabs_api_key}

    ws = await websockets.connect(
        url,
        additional_headers=headers,
        max_size=8 * 1024 * 1024,
        open_timeout=10,
        ping_interval=20,
        ping_timeout=20,
    )

    try:
        await ws.send(
            json.dumps(
                {
                    "text": " ",
                    "voice_settings": _VOICE_SETTINGS,
                    "generation_config": {
                        # Smaller chunks => earlier first audio.
                        "chunk_length_schedule": [50, 90, 120, 150],
                    },
                }
            )
        )
        yield ws
    finally:
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass


async def create_realtime_scribe_token() -> Tuple[str | None, str | None]:
    """Return (single_use_token, error) for browser-side ElevenLabs realtime STT."""
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        return None, "ELEVENLABS_API_KEY is not set on the server."

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
                headers={"xi-api-key": settings.elevenlabs_api_key},
            )
    except httpx.HTTPError as exc:
        LOGGER.warning("ElevenLabs realtime token error: %s", exc)
        return None, str(exc)[:200]

    if r.status_code < 400:
        try:
            token = str((r.json() or {}).get("token") or "").strip()
            if token:
                return token, None
        except Exception:  # noqa: BLE001
            pass

    detail = (r.text or "")[:300]
    LOGGER.warning("ElevenLabs realtime token failed (%s): %s", r.status_code, detail)
    return None, f"ElevenLabs realtime token failed ({r.status_code}): {detail}"


async def transcribe_audio(filename: str, content_type: str, content: bytes) -> Tuple[str | None, str | None]:
    """Return (transcribed_text, error). Uses ElevenLabs Scribe STT."""
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        return None, "ELEVENLABS_API_KEY is not set on the server."
    if not content:
        return None, "empty audio payload"

    # Force English transcription (ISO 639-1). Without this, Scribe auto-detects and may
    # return Thai/other scripts when the user's environment or accent confuses the model.
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
                files={"file": (filename or "speech.webm", content, content_type or "application/octet-stream")},
            )
    except httpx.HTTPError as exc:
        LOGGER.warning("ElevenLabs STT error: %s", exc)
        return None, str(exc)[:200]

    if r.status_code < 400:
        try:
            payload = r.json()
            text = str(payload.get("text") or "").strip()
            if text:
                return text, None
        except Exception:  # noqa: BLE001
            pass

    detail = (r.text or "")[:300]
    LOGGER.warning("ElevenLabs STT failed (%s): %s", r.status_code, detail)
    return None, f"ElevenLabs STT failed ({r.status_code}): {detail}"
