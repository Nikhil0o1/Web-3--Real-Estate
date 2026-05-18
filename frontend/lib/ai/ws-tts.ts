"use client";

/**
 * WebSocket TTS session — streams LLM tokens to the backend (which proxies to
 * ElevenLabs `stream-input`), receives PCM-16 @ 16 kHz audio chunks, and
 * schedules them on a single AudioContext timeline for gapless playback.
 *
 * Usage:
 *
 *   const tts = await openTtsSession({ onFirstAudio, onEnd, onError });
 *   tts.appendText("Hello ");
 *   tts.appendText("world.");
 *   tts.flush();      // signal end of utterance
 *   tts.abort();      // hard stop (barge-in)
 *
 * One session per assistant turn. Replaces the per-sentence MP3 queue.
 */

import { getApiBase } from "@/lib/api";
import { mark } from "./telemetry";

const SAMPLE_RATE = 16000;

export type TtsSessionOptions = {
  voice?: string;
  traceId?: string;
  /** Called when the AudioContext schedules the first sample for playback. */
  onPlayStart?: () => void;
  /** Called when all queued audio has finished playing. */
  onPlayEnd?: () => void;
  /** Called as soon as the first audio chunk arrives from the server. */
  onFirstAudio?: () => void;
  /** Called when the server signals end of utterance. */
  onEnd?: () => void;
  /** Called on fatal errors. */
  onError?: (detail: string) => void;
  /** Receives the AnalyserNode for waveform visualization (during playback). */
  onAnalyser?: (analyser: AnalyserNode) => void;
};

export type TtsSession = {
  appendText: (text: string) => void;
  flush: () => void;
  abort: () => void;
  isClosed: () => boolean;
  /** Promise that resolves when audio has finished playing (or was aborted). */
  done: Promise<void>;
};

function _authToken(): string {
  try {
    const raw = localStorage.getItem("estatechain.session.v1");
    if (!raw) return "";
    return JSON.parse(raw).token || "";
  } catch {
    return "";
  }
}

function _wsUrl(): string {
  const base = getApiBase();
  const url = new URL(base, typeof window !== "undefined" ? window.location.href : "http://localhost");
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = url.pathname.replace(/\/+$/, "") + "/api/ai/voice/tts/ws";
  return url.toString();
}

function _pcm16ToFloat32(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  const samples = bytes.byteLength / 2;
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return out;
}

let _sharedCtx: AudioContext | null = null;
function _audioContext(): AudioContext {
  if (_sharedCtx && _sharedCtx.state !== "closed") return _sharedCtx;
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  _sharedCtx = new AC();
  return _sharedCtx!;
}

export async function openTtsSession(opts: TtsSessionOptions = {}): Promise<TtsSession> {
  const token = _authToken();
  const url = new URL(_wsUrl());
  if (token) url.searchParams.set("token", token);
  if (opts.voice) url.searchParams.set("voice", opts.voice);

  const ctx = _audioContext();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* ignore */
    }
  }

  const gain = ctx.createGain();
  gain.gain.value = 1;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;
  gain.connect(analyser);
  analyser.connect(ctx.destination);
  opts.onAnalyser?.(analyser);

  let closed = false;
  let endedAnnounced = false;
  let firstAudio = false;
  let playStartFired = false;
  let nextStartTime = 0;
  const liveNodes = new Set<AudioBufferSourceNode>();
  let endedResolve: () => void = () => {};
  const done = new Promise<void>((res) => {
    endedResolve = res;
  });

  const fireEndIfIdle = () => {
    if (!closed) return;
    if (liveNodes.size > 0) return;
    if (!endedAnnounced) {
      endedAnnounced = true;
      mark(opts.traceId ?? null, "tts_play_end");
      opts.onPlayEnd?.();
      endedResolve();
    }
  };

  const enqueuePcm = (bytes: ArrayBuffer) => {
    if (closed) return;
    const samples = _pcm16ToFloat32(bytes);
    if (samples.length === 0) return;
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const now = ctx.currentTime;
    const startAt = Math.max(now, nextStartTime);
    if (!playStartFired) {
      playStartFired = true;
      mark(opts.traceId ?? null, "tts_play_start");
      opts.onPlayStart?.();
    }
    source.start(startAt);
    nextStartTime = startAt + buffer.duration;
    liveNodes.add(source);
    source.onended = () => {
      liveNodes.delete(source);
      fireEndIfIdle();
    };
  };

  const ws = new WebSocket(url.toString());
  ws.binaryType = "arraybuffer";

  mark(opts.traceId ?? null, "tts_open");

  ws.onmessage = (event) => {
    if (typeof event.data === "string") {
      try {
        const payload = JSON.parse(event.data) as { type?: string; detail?: string };
        if (payload.type === "first_audio") {
          if (!firstAudio) {
            firstAudio = true;
            mark(opts.traceId ?? null, "tts_first_audio");
            opts.onFirstAudio?.();
          }
        } else if (payload.type === "end") {
          opts.onEnd?.();
          // Mark closed so source.onended drains the promise.
          closed = true;
          fireEndIfIdle();
        } else if (payload.type === "error") {
          opts.onError?.(payload.detail || "TTS WS error");
          closed = true;
          fireEndIfIdle();
        }
      } catch {
        /* ignore non-JSON text */
      }
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      if (!firstAudio) {
        firstAudio = true;
        mark(opts.traceId ?? null, "tts_first_audio");
        opts.onFirstAudio?.();
      }
      enqueuePcm(event.data);
    }
  };

  ws.onerror = () => {
    opts.onError?.("TTS WS connection error");
  };

  ws.onclose = () => {
    closed = true;
    fireEndIfIdle();
  };

  // Wait until OPEN before allowing appendText to flow.
  if (ws.readyState === WebSocket.CONNECTING) {
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onErr);
        resolve();
      };
      const onErr = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onErr);
        reject(new Error("TTS WS failed to open"));
      };
      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onErr);
    });
  }

  let firstTextSent = false;
  const safeSend = (msg: object) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* ignore */
    }
  };

  return {
    appendText(text: string) {
      const clean = text.replace(/\s+/g, " ");
      if (!clean) return;
      if (!firstTextSent) {
        firstTextSent = true;
        mark(opts.traceId ?? null, "tts_first_text");
      }
      safeSend({ type: "text", text: clean.endsWith(" ") ? clean : clean + " " });
    },
    flush() {
      safeSend({ type: "flush" });
    },
    abort() {
      if (closed) return;
      closed = true;
      // Stop all in-flight buffer sources.
      for (const node of liveNodes) {
        try {
          node.stop(0);
          node.disconnect();
        } catch {
          /* ignore */
        }
      }
      liveNodes.clear();
      try {
        gain.disconnect();
        analyser.disconnect();
      } catch {
        /* ignore */
      }
      safeSend({ type: "abort" });
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      mark(opts.traceId ?? null, "barge_in");
      fireEndIfIdle();
    },
    isClosed() {
      return closed;
    },
    done,
  };
}
