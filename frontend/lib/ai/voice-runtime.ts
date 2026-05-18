"use client";

/**
 * Clean voice runtime — ElevenLabs TTS + ElevenLabs Scribe STT.
 *
 * TTS: Backend ElevenLabs streaming via /api/ai/voice/speak/stream.
 * STT: Browser microphone PCM -> ElevenLabs Scribe Realtime WebSocket.
 *
 * No legacy Web Speech API. No browser TTS fallback.
 */

import { aiRealtimeVoiceToken, aiSpeak, aiSpeakStream } from "./api";
import { openTtsSession, type TtsSession } from "./ws-tts";

/* -------------------------------------------------------------------------- */
/*  TTS                                                                       */
/* -------------------------------------------------------------------------- */

let _speaking = false;
const _speakingListeners = new Set<(speaking: boolean) => void>();

function setSpeaking(value: boolean) {
  if (_speaking === value) return;
  _speaking = value;
  _speakingListeners.forEach((cb) => cb(value));
}

export function onSpeakingChange(cb: (speaking: boolean) => void): () => void {
  _speakingListeners.add(cb);
  cb(_speaking);
  return () => _speakingListeners.delete(cb);
}

export function isSpeaking() {
  return _speaking;
}

/** Call once from a user gesture to unlock AudioContext autoplay policy. */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  try {
    const a = new Audio();
    a.muted = true;
    a.src = "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA//////////////////////////8AAAA8TEFNRTMuMTAwAc0AAAAAAAAAABRgJAJAQgAAYAAAASAaW4D3LAAAAAAAAAAAAAAAAA";
    void a.play().then(() => a.pause());
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/*  Streaming TTS — sentence-level audio queue (ChatGPT voice-mode style)   */
/* -------------------------------------------------------------------------- */

type TtsQueueItem = {
  text: string;
  gen: number;
};

let _audioQueue: TtsQueueItem[] = [];
let _isPlayingQueue = false;
let _currentAudio: HTMLAudioElement | null = null;
let _currentTtsAbort: AbortController | null = null;
let _ttsGen = 0; // incremented on clearAudioQueue to cancel in-flight sentences

function playAudioBuffer(buffer: ArrayBuffer, gen: number): Promise<void> {
  return new Promise((resolve) => {
    if (gen !== _ttsGen) {
      resolve();
      return;
    }
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    _currentAudio = audio;

    const done = () => {
      URL.revokeObjectURL(url);
      if (_currentAudio === audio) _currentAudio = null;
      resolve();
    };

    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  });
}

async function playStreamingResponse(response: Response, gen: number): Promise<void> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (gen !== _ttsGen) return;
    await playAudioBuffer(buffer, gen);
    return;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value);
      totalLength += value.byteLength;
      if (gen !== _ttsGen) {
        reader.cancel().catch(() => {});
        return;
      }
    }
  } catch {
    /* reader error — fall through to play what we buffered */
  } finally {
    reader.releaseLock();
  }

  if (gen !== _ttsGen) return;
  if (totalLength === 0) return;

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  await playAudioBuffer(combined.buffer, gen);
}

async function playTtsText(text: string, gen: number): Promise<void> {
  _currentTtsAbort = new AbortController();
  try {
    const response = await aiSpeakStream({ text }, _currentTtsAbort.signal);
    if (gen !== _ttsGen) return;
    await playStreamingResponse(response, gen);
  } catch {
    if (gen !== _ttsGen) return;
    try {
      const buffer = await aiSpeak({ text });
      if (gen === _ttsGen) await playAudioBuffer(buffer, gen);
    } catch {
      /* silently skip a broken sentence so the stream never stalls */
    }
  } finally {
    _currentTtsAbort = null;
  }
}

async function _playNextInQueue() {
  if (_audioQueue.length === 0) {
    _isPlayingQueue = false;
    _currentAudio = null;
    setSpeaking(false);
    return;
  }
  _isPlayingQueue = true;
  setSpeaking(true);
  const item = _audioQueue.shift()!;
  await playTtsText(item.text, item.gen);
  if (item.gen === _ttsGen) {
    void _playNextInQueue();
  }
}

/** Enqueue a single sentence for TTS. Starts playing immediately if queue was idle. */
export async function speakSentence(text: string): Promise<void> {
  if (typeof window === "undefined" || !text.trim()) return;
  const gen = _ttsGen;
  _audioQueue.push({ text: text.trim(), gen });
  if (!_isPlayingQueue) {
    void _playNextInQueue();
  }
}

/** Clear all pending audio and stop current playback. */
export function clearAudioQueue() {
  _ttsGen++;
  _currentTtsAbort?.abort();
  _currentTtsAbort = null;
  if (_currentAudio) {
    try {
      _currentAudio.pause();
      _currentAudio.currentTime = 0;
    } catch {
      /* ignore */
    }
    _currentAudio = null;
  }
  _audioQueue = [];
  _isPlayingQueue = false;
  if (_currentTtsSession) {
    try {
      _currentTtsSession.abort();
    } catch {
      /* ignore */
    }
    _currentTtsSession = null;
  }
  _onAnalyserCb?.(null);
  setSpeaking(false);
}

/** Whether the audio queue is fully idle. */
export function isAudioQueueEmpty(): boolean {
  return _audioQueue.length === 0 && !_isPlayingQueue;
}

/** Cancel any playing audio. */
export function cancelSpeech() {
  clearAudioQueue();
  setSpeaking(false);
}

/** Speak full text (waits until the queue drains). */
export async function speak(text: string): Promise<void> {
  if (typeof window === "undefined" || !text.trim()) return;
  await speakSentence(text);
  return new Promise((resolve) => {
    const check = () => {
      if (isAudioQueueEmpty()) resolve();
      else setTimeout(check, 80);
    };
    check();
  });
}

/* -------------------------------------------------------------------------- */
/*  Streaming TTS over WebSocket — single continuous session per turn         */
/* -------------------------------------------------------------------------- */

let _currentTtsSession: TtsSession | null = null;
let _onBargeInCb: (() => void) | null = null;
let _onAnalyserCb: ((a: AnalyserNode | null) => void) | null = null;

/** Called when playback is aborted. Used by agent-store to re-arm STT. */
export function setBargeInHandler(cb: (() => void) | null) {
  _onBargeInCb = cb;
}

/** Optional: receive the active playback AnalyserNode for waveform UI. */
export function setPlaybackAnalyserHandler(cb: ((analyser: AnalyserNode | null) => void) | null) {
  _onAnalyserCb = cb;
}

/**
 * Open a streaming-TTS session for one assistant turn. The caller pushes text
 * via `appendText(token)` as LLM tokens arrive, then calls `flush()` when the
 * LLM finishes. The session aborts automatically on `clearAudioQueue()`.
 */
export async function openSpeakStream(opts?: { voice?: string; traceId?: string }): Promise<TtsSession> {
  if (typeof window === "undefined") {
    throw new Error("openSpeakStream is browser-only");
  }
  // Abort any prior session — only one turn speaks at a time.
  _currentTtsSession?.abort();
  _currentTtsSession = null;

  // Bump the legacy queue generation so any lingering MP3 sentence is dropped.
  _ttsGen++;
  _audioQueue = [];
  _isPlayingQueue = false;

  setSpeaking(true);

  const session = await openTtsSession({
    voice: opts?.voice,
    onAnalyser: (analyser) => _onAnalyserCb?.(analyser),
    onPlayEnd: () => {
      if (_currentTtsSession === session) {
        _currentTtsSession = null;
        _onAnalyserCb?.(null);
      }
      setSpeaking(false);
    },
    onError: (detail) => {
      console.warn("[ws-tts]", detail);
    },
  });
  _currentTtsSession = session;

  return session;
}

/** True if a WS-TTS session is actively streaming. */
export function isStreamingTts(): boolean {
  return _currentTtsSession !== null && !_currentTtsSession.isClosed();
}

/* -------------------------------------------------------------------------- */
/*  STT                                                                       */
/* -------------------------------------------------------------------------- */

export type RecorderOptions = {
  onEnd?: () => void;
  onError?: (error: string) => void;
  silenceMs?: number;
  maxDurationMs?: number;
  noSpeechMs?: number;
};

export type RealtimeTranscriptionEndReason = "committed" | "vad" | "manual" | "max" | "noSpeech" | "closed" | "error";

export type RealtimeTranscriptionOptions = {
  onOpen?: () => void;
  onPartial?: (text: string) => void;
  onCommitted?: (text: string) => void;
  onEnd?: (reason: RealtimeTranscriptionEndReason) => void;
  onError?: (error: string) => void;
  silenceMs?: number;
  maxDurationMs?: number;
  noSpeechMs?: number;
  previousText?: string;
  /** Receive the playback-side analyser for waveform visualization. */
  onAnalyser?: (analyser: AnalyserNode) => void;
};

let _recorder: MediaRecorder | null = null;
let _stream: MediaStream | null = null;
let _chunks: Blob[] = [];
let _vadFrame: number | null = null;
let _audioCtx: AudioContext | null = null;
let _stopRealtime: (() => void) | null = null;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of opts) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

function realtimeWsUrl(token: string, modelId: string, languageCode: string): string {
  const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
  url.searchParams.set("token", token);
  url.searchParams.set("model_id", modelId || "scribe_v2_realtime");
  url.searchParams.set("audio_format", "pcm_16000");
  url.searchParams.set("language_code", languageCode || "en");
  return url.toString();
}

function createRealtimeAudioContext(): AudioContext {
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) throw new Error("AudioContext not supported");
  try {
    return new AC({ sampleRate: 16000 });
  } catch {
    return new AC();
  }
}

export function startRealtimeTranscription(opts: RealtimeTranscriptionOptions): () => void {
  cleanupRecorder();
  _stopRealtime?.();
  cancelSpeech();

  const maxDurationMs = opts.maxDurationMs ?? 30000;
  const noSpeechMs = opts.noSpeechMs ?? 12000;

  let ws: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let silentGain: GainNode | null = null;
  let analyserNode: AnalyserNode | null = null;
  let ended = false;
  let captureStopped = false;

  let lastPartial = "";
  let finalText = "";
  let committedDelivered = false;

  const deliverCommitted = (text: string) => {
    const clean = text.trim();
    if (!clean || committedDelivered) return;
    committedDelivered = true;
    opts.onCommitted?.(clean);
  };

  const finish = (reason: RealtimeTranscriptionEndReason) => {
    if (ended) return;
    ended = true;

    captureStopped = true;
    try {
      workletNode?.port.close();
      workletNode?.disconnect();
      source?.disconnect();
      silentGain?.disconnect();
      analyserNode?.disconnect();
    } catch {
      /* ignore */
    }
    workletNode = null;
    source = null;
    silentGain = null;
    analyserNode = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;

    ctx?.close().catch(() => {});
    ctx = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    ws = null;
    if (_stopRealtime === stop) _stopRealtime = null;

    deliverCommitted(finalText || lastPartial);
    opts.onEnd?.(reason);
  };

  const stop = () => {
    finish(finalText || lastPartial ? "committed" : "manual");
  };

  _stopRealtime = stop;

  const startAudioPump = async () => {
    if (!ctx || !stream || !ws || ended) return;

    try {
      await ctx.audioWorklet.addModule("/audio/pcm-worklet.js");
    } catch (err) {
      console.warn("[stt] failed to load pcm-worklet:", err);
      opts.onError?.("Audio worklet load failed");
      finish("error");
      return;
    }
    if (ended || captureStopped) return;

    source = ctx.createMediaStreamSource(stream);
    silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.7;

    workletNode = new AudioWorkletNode(ctx, "pcm-worklet", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
      processorOptions: { targetRate: 16000, chunkSamples: 800 },
    });

    workletNode.port.onmessage = (event) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || ended || captureStopped) return;
      const data = event.data;
      if (!(data instanceof ArrayBuffer) || data.byteLength === 0) return;
      // Send raw PCM16 directly to ElevenLabs — no JSON wrapping.
      ws.send(data);
    };

    source.connect(workletNode);
    source.connect(analyserNode);
    workletNode.connect(silentGain);
    silentGain.connect(ctx.destination);
    opts.onAnalyser?.(analyserNode);
  };

  void (async () => {
    try {
      const tokenResponse = await aiRealtimeVoiceToken();
      if (ended) return;

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (ended) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      ctx = createRealtimeAudioContext();
      await ctx.resume();

      ws = new WebSocket(
        realtimeWsUrl(tokenResponse.token, tokenResponse.model_id, tokenResponse.language_code),
      );

      ws.onopen = () => {
        opts.onOpen?.();
        void startAudioPump().catch((err) => {
          console.warn("[stt] audio pump start failed:", err);
          opts.onError?.("Audio pump failed to start");
          finish("error");
        });
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
          console.log("[STT] ws msg:", payload);

          const type = String(payload.type || payload.message_type || "");
          const text = String(payload.transcript ?? payload.text ?? "").trim();
          const isFinal =
            payload.is_final === true ||
            payload.isFinal === true ||
            type === "final_transcript" ||
            type === "committed_transcript";
          const isError = type.includes("error") || payload.error;

          if (isError) {
            const msg = String(payload.message ?? payload.detail ?? payload.error ?? "Realtime STT error");
            console.error("[STT] error:", msg);
            opts.onError?.(msg);
            finish("error");
            return;
          }

          if (text) {
            if (isFinal) {
              finalText = text;
              deliverCommitted(text);
              finish("committed");
            } else {
              lastPartial = text;
              opts.onPartial?.(text);
            }
          }
        } catch {
          // Non-JSON binary/ping — ignore
        }
      };

      ws.onerror = (e) => {
        console.error("[STT] ws error:", e);
        opts.onError?.("Realtime STT connection failed");
        finish("error");
      };

      ws.onclose = () => {
        finish(finalText || lastPartial ? "committed" : "closed");
      };

      // Safety timeouts
      window.setTimeout(() => {
        if (!ended) finish("max");
      }, maxDurationMs);

      window.setTimeout(() => {
        if (!ended && !lastPartial) finish("noSpeech");
      }, noSpeechMs);
    } catch (err: any) {
      console.error("[STT] setup error:", err);
      opts.onError?.(err?.message || err?.name || "Microphone access denied");
      finish("error");
    }
  })();

  return stop;
}

function cleanupRecorder() {
  if (_vadFrame !== null) {
    cancelAnimationFrame(_vadFrame);
    _vadFrame = null;
  }
  if (_recorder && _recorder.state !== "inactive") {
    try {
      _recorder.stop();
    } catch {
      /* ignore */
    }
  }
  _recorder = null;
  _audioCtx?.close().catch(() => {});
  _audioCtx = null;
  _stream?.getTracks().forEach((t) => t.stop());
  _stream = null;
  _chunks = [];
}

/** Start recording. Returns a cleanup function that stops everything. */
export function startRecording(opts: RecorderOptions): () => void {
  _stopRealtime?.();
  cleanupRecorder();
  cancelSpeech();

  const silenceAfterMs = opts.silenceMs ?? 1800;
  const maxDurationMs = opts.maxDurationMs ?? 30000;
  const noSpeechMs = opts.noSpeechMs ?? 12000;
  let cancelled = false;

  navigator.mediaDevices
    .getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    .then((stream) => {
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      _stream = stream;
      const mime = pickMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      _recorder = recorder;
      _chunks = [];

      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) throw new Error("AudioContext not supported");
      const ctx = new AC();
      _audioCtx = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);

      let heardSpeech = false;
      let silenceStart: number | null = null;
      const startedAt = performance.now();
      let noiseSamples = 0;
      let noiseAccum = 0;
      let noiseFloor = 0.005;
      let calibratedAt = 0;

      const stop = (reason: "vad" | "max" | "noSpeech") => {
        if (_vadFrame !== null) {
          cancelAnimationFrame(_vadFrame);
          _vadFrame = null;
        }
        try {
          if (recorder.state !== "inactive") recorder.stop();
        } catch {
          /* ignore */
        }
        if (reason === "noSpeech") {
          _chunks = []; // discard so caller sees empty blob
        }
      };

      const tick = () => {
        if (recorder.state === "inactive") return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();

        // Calibration — first 400ms
        if (now - startedAt < 400) {
          noiseAccum += rms;
          noiseSamples++;
          if (noiseSamples > 0) noiseFloor = noiseAccum / noiseSamples;
          _vadFrame = requestAnimationFrame(tick);
          return;
        }
        if (calibratedAt === 0) calibratedAt = now;

        const dynamic = Math.max(noiseFloor + 0.006, noiseFloor * 1.6);
        const threshold = Math.min(0.03, Math.max(0.012, dynamic));
        const loud = rms > threshold;

        if (loud) {
          heardSpeech = true;
          silenceStart = null;
        } else if (heardSpeech) {
          if (silenceStart === null) silenceStart = now;
          else if (now - silenceStart > silenceAfterMs) {
            stop("vad");
            return;
          }
        } else if (now - calibratedAt > noSpeechMs) {
          stop("noSpeech");
          return;
        }

        if (now - startedAt > maxDurationMs) {
          stop(heardSpeech ? "max" : "noSpeech");
          return;
        }
        _vadFrame = requestAnimationFrame(tick);
      };

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) _chunks.push(ev.data);
      };
      recorder.onstop = () => {
        opts.onEnd?.();
        cleanupRecorder();
      };

      recorder.start(250);
      _vadFrame = requestAnimationFrame(tick);
    })
    .catch((err) => {
      opts.onError?.(err?.message || err?.name || "Microphone access denied");
      cleanupRecorder();
    });

  return () => {
    cancelled = true;
    cleanupRecorder();
  };
}

/** Get the recorded blob after onEnd fires. */
export function getRecordedBlob(): Blob | null {
  if (!_chunks.length) return null;
  const mime = pickMime() || "audio/webm";
  return new Blob(_chunks, { type: mime });
}
