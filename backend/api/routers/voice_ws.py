"""ChatGPT-style duplex voice streaming.

Flow per turn:
  1. Frontend captures mic continuously; runs local VAD; on end-of-speech
     uploads the segment via /api/ai/voice/transcribe (HTTP, ElevenLabs Scribe).
  2. Frontend sends {"type": "intent", "text": "..."} over this WS.
  3. We stream LangGraph tokens to the frontend AND into ElevenLabs TTS WS.
     ElevenLabs returns PCM16 chunks (output_format=pcm_16000), which we
     forward to the browser. PCM is decode-safe per chunk (unlike chunked MP3)
     so playback can begin immediately with minimal latency.
  4. Frontend can send {"type": "interrupt"} for barge-in, which cancels the
     in-flight LLM + TTS streams.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from backend.ai.agent import stream_agent
from backend.ai.checkpointer import get_saver
from backend.ai.chunk_buffer import SmartChunkBuffer
from backend.ai.config import get_settings
from backend.ai.schemas import ChatMessage
from backend.db.connection import get_connection
from backend.services.auth import AuthError, AuthUser, resolve_authenticated_user

LOGGER = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai/voice", tags=["ai-voice"])


# ElevenLabs WS endpoint streams audio as base64 chunks in PCM at the requested rate.
_TTS_SAMPLE_RATE = 16000
_TTS_OUTPUT_FORMAT = f"pcm_{_TTS_SAMPLE_RATE}"


async def _elevenlabs_tts_stream(
    text_chunks: asyncio.Queue,
    out_audio: asyncio.Queue,
    cancel: asyncio.Event,
    voice_id: str,
) -> None:
    """Pump LLM token chunks into ElevenLabs WS TTS; push PCM bytes to ``out_audio``.

    ``text_chunks`` carries str pieces. A ``None`` sentinel signals end-of-text.
    Pushes ``None`` to ``out_audio`` when finished (success, cancel, or error).
    """
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        await out_audio.put(None)
        return

    import websockets

    url = (
        f"wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input"
        f"?model_id={settings.elevenlabs_model}"
        f"&output_format={_TTS_OUTPUT_FORMAT}"
        f"&inactivity_timeout=20"
    )

    try:
        async with websockets.connect(url, max_size=8 * 1024 * 1024) as ws:
            await ws.send(json.dumps({
                "text": " ",
                "voice_settings": {
                    "stability": 0.45,
                    "similarity_boost": 0.8,
                    "style": 0.15,
                    "use_speaker_boost": True,
                },
                "generation_config": {
                    "chunk_length_schedule": [80, 120, 180, 250],
                },
                "xi_api_key": settings.elevenlabs_api_key,
            }))

            async def pump_text():
                while True:
                    if cancel.is_set():
                        try:
                            await ws.send(json.dumps({"text": ""}))
                        except Exception:
                            pass
                        return
                    try:
                        chunk = await asyncio.wait_for(text_chunks.get(), timeout=0.1)
                    except asyncio.TimeoutError:
                        continue
                    if chunk is None:
                        await ws.send(json.dumps({"text": " ", "flush": True}))
                        await ws.send(json.dumps({"text": ""}))
                        return
                    if not chunk:
                        continue
                    await ws.send(json.dumps({"text": chunk, "try_trigger_generation": True}))

            send_task = asyncio.create_task(pump_text())

            try:
                while True:
                    if cancel.is_set():
                        break
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=0.2)
                    except asyncio.TimeoutError:
                        continue
                    try:
                        data = json.loads(raw)
                    except (TypeError, ValueError):
                        continue
                    audio_b64 = data.get("audio")
                    if audio_b64:
                        try:
                            pcm = base64.b64decode(audio_b64)
                            await out_audio.put(pcm)
                        except Exception as exc:  # noqa: BLE001
                            LOGGER.warning("TTS chunk decode error: %s", exc)
                    if data.get("isFinal"):
                        break
            finally:
                send_task.cancel()
                try:
                    await send_task
                except Exception:
                    pass
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("ElevenLabs TTS WS failed: %s", exc)
    finally:
        await out_audio.put(None)


def _anonymous() -> AuthUser:
    return AuthUser(
        id=0,
        wallet_address="0x0000000000000000000000000000000000000000",
        role="investor",
        email=None,
        kyc_status="unverified",
        active=True,
    )


def _authenticate(token: str | None) -> AuthUser:
    """Resolve the JWT from the query param into an AuthUser; anon on failure."""
    if not token:
        return _anonymous()
    db = None
    try:
        db = get_connection()
        return resolve_authenticated_user(db, token)
    except AuthError:
        return _anonymous()
    except Exception as exc:  # noqa: BLE001
        LOGGER.warning("Voice WS auth failed: %s", exc)
        return _anonymous()
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass


@router.websocket("/stream")
async def voice_duplex_stream(websocket: WebSocket, token: str | None = Query(default=None)):
    """Persistent duplex voice channel for the chat UI."""
    await websocket.accept()

    user = _authenticate(token)
    thread_id = f"voice:{user.wallet_address or user.id}"

    # State for the *current* in-flight turn so we can cancel on interrupt.
    cur_cancel: asyncio.Event | None = None
    cur_text_q: asyncio.Queue | None = None
    cur_tasks: list[asyncio.Task] = []

    # Server-side conversation history. The HTTP /chat path receives the full
    # transcript from the client every turn, but the voice WS only receives the
    # latest user utterance, so we must remember prior turns here. Without
    # this, the agent forgets what it already asked and re-asks the same
    # question after each answer (e.g. during the create-property workflow).
    history: list[ChatMessage] = []

    async def _cancel_current():
        nonlocal cur_cancel, cur_text_q, cur_tasks
        if cur_cancel:
            cur_cancel.set()
        if cur_text_q is not None:
            try:
                cur_text_q.put_nowait(None)
            except Exception:
                pass
        for t in cur_tasks:
            if not t.done():
                t.cancel()
        for t in cur_tasks:
            try:
                await t
            except Exception:
                pass
        cur_cancel = None
        cur_text_q = None
        cur_tasks = []

    async def _run_turn(user_text: str):
        nonlocal cur_cancel, cur_text_q, cur_tasks
        await _cancel_current()
        cancel = asyncio.Event()
        text_q: asyncio.Queue = asyncio.Queue()
        audio_q: asyncio.Queue = asyncio.Queue()
        cur_cancel = cancel
        cur_text_q = text_q

        voice_id = get_settings().elevenlabs_voice_id

        # Append the new user message to the running transcript BEFORE we
        # start streaming so the agent sees full context.
        history.append(ChatMessage(role="user", content=user_text))

        async def llm_pump():
            checkpointer = await get_saver()
            full_text = ""
            # SmartChunkBuffer batches tokens into 25..60 char phrase chunks at
            # punctuation boundaries before flushing to ElevenLabs. Token-level
            # feeding produces fragmented prosody; phrase-level feeding sounds
            # natural while still streaming as the LLM generates.
            chunker = SmartChunkBuffer(min_chars=25, max_chars=60)
            # Each turn gets its own DB connection. Read-only tools share it,
            # write tools (delete_property) commit through it. We close in
            # finally so a long-lived voice session never leaks connections.
            db = None
            try:
                db = get_connection()
            except Exception as exc:  # noqa: BLE001
                LOGGER.warning("Voice turn: DB connect failed (read-only mode): %s", exc)
                db = None
            try:
                async for event in stream_agent(
                    user,
                    history,
                    db,
                    thread_id=thread_id,
                    checkpointer=checkpointer,
                ):
                    if cancel.is_set():
                        break
                    if event.get("type") == "token":
                        delta = event.get("content") or ""
                        if delta:
                            full_text += delta
                            await websocket.send_json({"type": "token", "text": delta})
                            for chunk in chunker.feed(delta):
                                # Trailing space helps ElevenLabs pace between
                                # phrases and keeps token boundaries clean.
                                await text_q.put(chunk + " ")
                    elif event.get("type") == "tool_start":
                        await websocket.send_json({
                            "type": "tool_start",
                            "name": event.get("name", ""),
                        })
                    elif event.get("type") == "complete":
                        actions = event.get("actions") or []
                        reply = event.get("reply") or full_text
                        tail = chunker.flush()
                        if tail:
                            await text_q.put(tail + " ")
                        elif not full_text and reply:
                            await text_q.put(reply)
                        # Remember the assistant reply so the next user turn
                        # has the full context (this is what fixes the
                        # "AI re-asks the same question" loop).
                        if reply:
                            history.append(ChatMessage(role="assistant", content=reply))
                        await websocket.send_json({
                            "type": "complete",
                            "reply": reply,
                            "actions": actions,
                        })
            except Exception as exc:  # noqa: BLE001
                LOGGER.exception("LLM pump failed: %s", exc)
                try:
                    await websocket.send_json({"type": "error", "detail": str(exc)[:200]})
                except Exception:
                    pass
            finally:
                if db is not None:
                    try:
                        db.close()
                    except Exception:
                        pass
                # Make sure anything still buffered when an exception fires also flushes.
                tail = chunker.flush()
                if tail:
                    try:
                        await text_q.put(tail + " ")
                    except Exception:
                        pass
                await text_q.put(None)

        async def tts_pump():
            await _elevenlabs_tts_stream(text_q, audio_q, cancel, voice_id)

        async def audio_pump():
            while True:
                chunk = await audio_q.get()
                if chunk is None:
                    try:
                        await websocket.send_json({"type": "audio_end"})
                    except Exception:
                        pass
                    return
                if cancel.is_set():
                    continue
                try:
                    await websocket.send_json({
                        "type": "audio",
                        "chunk": base64.b64encode(chunk).decode("ascii"),
                        "sample_rate": _TTS_SAMPLE_RATE,
                    })
                except Exception:
                    return

        cur_tasks = [
            asyncio.create_task(llm_pump()),
            asyncio.create_task(tts_pump()),
            asyncio.create_task(audio_pump()),
        ]

    try:
        await websocket.send_json({"type": "ready", "sample_rate": _TTS_SAMPLE_RATE})
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except (TypeError, ValueError):
                continue
            kind = msg.get("type")
            if kind == "intent":
                text = (msg.get("text") or "").strip()
                if text:
                    await _run_turn(text)
            elif kind == "interrupt":
                await _cancel_current()
                try:
                    await websocket.send_json({"type": "interrupted"})
                except Exception:
                    pass
            elif kind == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        LOGGER.error("Voice WS error: %s", exc)
    finally:
        await _cancel_current()
        try:
            await websocket.close()
        except Exception:
            pass
