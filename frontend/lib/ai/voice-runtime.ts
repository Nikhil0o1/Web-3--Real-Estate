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
import { createSileroVad, type SileroVadHandle } from "./silero-vad";
import { startBargeInWatcher, type BargeInHandle } from "./barge-in";
import { mark, newTrace } from "./telemetry";
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
  if (_currentBargeIn) {
    _currentBargeIn.stop().catch(() => {});
    _currentBargeIn = null;
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
let _currentBargeIn: BargeInHandle | null = null;
let _bargeInEnabled = true;
let _onBargeInCb: (() => void) | null = null;
let _onAnalyserCb: ((a: AnalyserNode | null) => void) | null = null;

export function setBargeInEnabled(enabled: boolean) {
  _bargeInEnabled = enabled;
}

export function isBargeInEnabled() {
  return _bargeInEnabled;
}

/** Called when a confirmed barge-in fires. Used by agent-store to re-arm STT. */
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
  _currentBargeIn?.stop().catch(() => {});
  _currentBargeIn = null;

  // Bump the legacy queue generation so any lingering MP3 sentence is dropped.
  _ttsGen++;
  _audioQueue = [];
  _isPlayingQueue = false;

  setSpeaking(true);

  const session = await openTtsSession({
    voice: opts?.voice,
    traceId: opts?.traceId,
    onAnalyser: (analyser) => _onAnalyserCb?.(analyser),
    onPlayEnd: () => {
      if (_currentTtsSession === session) {
        _currentTtsSession = null;
        _currentBargeIn?.stop().catch(() => {});
        _currentBargeIn = null;
        _onAnalyserCb?.(null);
      }
      setSpeaking(false);
    },
    onError: (detail) => {
      console.warn("[ws-tts]", detail);
    },
  });
  _currentTtsSession = session;

  // Start the barge-in watcher in parallel — it grabs its own mic stream with
  // echoCancellation so the assistant's own audio doesn't trigger it.
  if (_bargeInEnabled) {
    startBargeInWatcher({
      traceId: opts?.traceId,
      onInterrupt: () => {
        if (_currentTtsSession !== session) return;
        session.abort();
        _currentTtsSession = null;
        _currentBargeIn?.stop().catch(() => {});
        _currentBargeIn = null;
        _onAnalyserCb?.(null);
        setSpeaking(false);
        _onBargeInCb?.();
      },
    })
      .then((handle) => {
        if (_currentTtsSession !== session) {
          void handle.stop();
          return;
        }
        _currentBargeIn = handle;
      })
      .catch((err) => console.warn("[barge-in] start failed:", err));
  }

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
  /** Live VAD probability (0..1) for diagnostics. */
  onVadProbability?: (p: number) => void;
  /** Reuse an existing telemetry trace id; otherwise a fresh one is created. */
  traceId?: string;
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

function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const slice = bytes.subarray(i, i + 0x8000);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function resampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  const outputSampleRate = 16000;
  if (inputSampleRate === outputSampleRate) return input;
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    output[i] = count > 0 ? sum / count : input[Math.min(start, input.length - 1)] || 0;
  }

  return output;
}

function floatToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function concatPcm(chunks: Int16Array[], totalSamples: number): Int16Array {
  const output = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function realtimeWsUrl(token: string, modelId: string, languageCode: string, silenceMs: number): string {
  const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
  url.searchParams.set("token", token);
  url.searchParams.set("model_id", modelId || "scribe_v2_realtime");
  url.searchParams.set("audio_format", "pcm_16000");
  url.searchParams.set("language_code", languageCode || "en");
  url.searchParams.set("commit_strategy", "vad");
  url.searchParams.set("vad_silence_threshold_secs", String(Math.min(3, Math.max(0.3, silenceMs / 1000))));
  url.searchParams.set("vad_threshold", "0.35");
  url.searchParams.set("min_speech_duration_ms", "120");
  url.searchParams.set("min_silence_duration_ms", "120");
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

function describeRealtimeError(payload: Record<string, unknown>, fallback: string): string {
  const detail = payload.message || payload.detail || payload.error || payload.reason;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}

export function startRealtimeTranscription(opts: RealtimeTranscriptionOptions): () => void {
  cleanupRecorder();
  _stopRealtime?.();
  cancelSpeech();

  const silenceAfterMs = opts.silenceMs ?? 1100;
  const maxDurationMs = opts.maxDurationMs ?? 30000;
  const noSpeechMs = opts.noSpeechMs ?? 12000;

  let ws: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let silentGain: GainNode | null = null;
  let analyserNode: AnalyserNode | null = null;
  let silero: SileroVadHandle | null = null;
  let pendingChunks: Int16Array[] = [];
  let pendingSamples = 0;
  let ended = false;
  let captureStopped = false;
  let heardSpeech = false;
  let maxTriggered = false;
  let commitTimer: number | null = null;
  let firstChunk = true;
  const startedAt = performance.now();
  const traceId = opts.traceId || newTrace();
  mark(traceId, "mic_open");

  // Transcript accumulation
  let lastPartial = "";
  let finalText = "";
  let committedDelivered = false;

  const notifyEnd = (reason: RealtimeTranscriptionEndReason) => {
    opts.onEnd?.(reason);
  };

  const deliverCommitted = (text: string) => {
    const clean = text.trim();
    if (!clean || committedDelivered) return;
    committedDelivered = true;
    opts.onCommitted?.(clean);
  };

  const flushAudio = (commit = false) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (pendingSamples <= 0 && !commit) return;
    const pcm = pendingSamples > 0 ? concatPcm(pendingChunks, pendingSamples) : new Int16Array(320);
    pendingChunks = [];
    pendingSamples = 0;
    const message: Record<string, unknown> = {
      message_type: "input_audio_chunk",
      audio_base_64: pcm16ToBase64(pcm),
      sample_rate: 16000,
    };
    if (commit) message.commit = true;
    if (firstChunk && opts.previousText?.trim()) {
      message.previous_text = opts.previousText.trim().slice(-1000);
    }
    firstChunk = false;
    ws.send(JSON.stringify(message));
  };

  const stopCapture = () => {
    if (captureStopped) return;
    captureStopped = true;
    try {
      processor?.disconnect();
      source?.disconnect();
      silentGain?.disconnect();
      analyserNode?.disconnect();
    } catch {
      /* ignore */
    }
    processor = null;
    source = null;
    silentGain = null;
    analyserNode = null;
    void silero?.destroy().catch(() => {});
    silero = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  const finish = (reason: RealtimeTranscriptionEndReason) => {
    if (ended) return;
    ended = true;
    if (commitTimer !== null) {
      window.clearTimeout(commitTimer);
      commitTimer = null;
    }
    stopCapture();
    ctx?.close().catch(() => {});
    ctx = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    ws = null;
    if (_stopRealtime === stop) _stopRealtime = null;

    deliverCommitted(finalText || lastPartial);
    notifyEnd(reason);
  };

  const commitAndStopCapture = (reason: "vad" | "manual" | "max") => {
    if (ended || captureStopped) return;
    flushAudio(true);
    stopCapture();
    notifyEnd(reason);

    commitTimer = window.setTimeout(() => {
      if (ended) return;
      const best = finalText || lastPartial;
      if (best) {
        deliverCommitted(best);
        finish("committed");
      } else {
        finish("closed");
      }
    }, 1800);
  };

  const stop = () => {
    if (heardSpeech || lastPartial) {
      commitAndStopCapture("manual");
    } else {
      finish("manual");
    }
  };

  _stopRealtime = stop;

  const startAudioPump = () => {
    if (!ctx || !stream || !ws || ended) return;
    source = ctx.createMediaStreamSource(stream);
    processor = ctx.createScriptProcessor(4096, 1, 1);
    silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.7;
    source.connect(processor);
    source.connect(analyserNode);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);
    opts.onAnalyser?.(analyserNode);

    processor.onaudioprocess = (event) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || ended || captureStopped) return;
      const input = event.inputBuffer.getChannelData(0);
      const now = performance.now();

      const pcm = floatToPcm16(resampleTo16k(input, ctx!.sampleRate));
      pendingChunks.push(pcm);
      pendingSamples += pcm.length;
      if (pendingSamples >= 1600) flushAudio();

      if (!heardSpeech && now - startedAt > noSpeechMs) {
        finish("noSpeech");
        return;
      }
      if (!maxTriggered && now - startedAt > maxDurationMs) {
        maxTriggered = true;
        commitAndStopCapture("max");
      }
    };
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
        realtimeWsUrl(tokenResponse.token, tokenResponse.model_id, tokenResponse.language_code, silenceAfterMs),
      );

      ws.onopen = () => {
        opts.onOpen?.();
        startAudioPump();
        // Spin up Silero VAD on the same stream/context. Speech-end commits;
        // speech-start flips `heardSpeech` so noSpeech timeouts behave correctly.
        if (stream && ctx) {
          void createSileroVad({
            stream,
            audioContext: ctx,
            model: "v5",
            positiveSpeechThreshold: 0.55,
            negativeSpeechThreshold: 0.4,
            minSpeechMs: 220,
            redemptionMs: Math.max(400, silenceAfterMs - 200),
            preSpeechPadMs: 160,
            onEvent: (event) => {
              if (event.kind === "frame") {
                opts.onVadProbability?.(event.probability);
                return;
              }
              if (event.kind === "speech_start" || event.kind === "speech_real_start") {
                if (!heardSpeech) mark(traceId, "vad_speech_start");
                heardSpeech = true;
                return;
              }
              if (event.kind === "speech_end") {
                if (ended || captureStopped) return;
                mark(traceId, "vad_speech_end");
                commitAndStopCapture("vad");
              }
            },
            onError: (err) => console.warn("[silero-vad]", err),
          })
            .then((handle) => {
              if (ended || captureStopped) {
                void handle.destroy();
                return;
              }
              silero = handle;
              return handle.start();
            })
            .catch((err) => console.warn("[silero-vad] init failed:", err));
        }
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
          const type = String(payload.message_type || payload.type || "");
          const audioEvent =
            payload.audio_event && typeof payload.audio_event === "object"
              ? (payload.audio_event as Record<string, unknown>)
              : {};
          const text = String(payload.transcript ?? payload.text ?? audioEvent.transcript ?? "").trim();
          const isFinal =
            payload.is_final === true ||
            payload.isFinal === true ||
            type === "final_transcript" ||
            type === "committed_transcript" ||
            type === "committed_transcript_with_timestamps";
          const isError = type.includes("error");

          if (isError) {
            opts.onError?.(describeRealtimeError(payload, `Realtime STT failed: ${type || "unknown error"}`));
            finish("error");
            return;
          }

          if (text) {
            if (isFinal) {
              finalText = text;
              mark(traceId, "stt_commit");
              deliverCommitted(text);
              finish("committed");
            } else {
              if (!lastPartial) mark(traceId, "first_partial");
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
