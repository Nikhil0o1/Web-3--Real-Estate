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

function appendSourceBuffer(sourceBuffer: SourceBuffer, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const onUpdate = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Audio stream append failed"));
    };
    const cleanup = () => {
      sourceBuffer.removeEventListener("updateend", onUpdate);
      sourceBuffer.removeEventListener("error", onError);
    };
    sourceBuffer.addEventListener("updateend", onUpdate, { once: true });
    sourceBuffer.addEventListener("error", onError, { once: true });
    try {
      const buffer = new ArrayBuffer(chunk.byteLength);
      new Uint8Array(buffer).set(chunk);
      sourceBuffer.appendBuffer(buffer);
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

async function playStreamingResponse(response: Response, gen: number): Promise<void> {
  const MediaSourceCtor = typeof window !== "undefined" ? window.MediaSource : undefined;
  const mime = "audio/mpeg";
  if (!MediaSourceCtor || !MediaSourceCtor.isTypeSupported(mime) || !response.body) {
    const buffer = await response.arrayBuffer();
    await playAudioBuffer(buffer, gen);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const mediaSource = new MediaSourceCtor();
    const url = URL.createObjectURL(mediaSource);
    const audio = new Audio(url);
    _currentAudio = audio;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      if (_currentAudio === audio) _currentAudio = null;
      resolve();
    };

    const fail = (err?: unknown) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      if (_currentAudio === audio) _currentAudio = null;
      reject(err instanceof Error ? err : new Error("Streaming audio playback failed"));
    };

    audio.onended = finish;
    audio.onerror = () => fail();

    mediaSource.addEventListener(
      "sourceopen",
      () => {
        void (async () => {
          try {
            const reader = response.body!.getReader();
            const sourceBuffer = mediaSource.addSourceBuffer(mime);
            let started = false;

            while (gen === _ttsGen) {
              const { done, value } = await reader.read();
              if (done) break;
              if (!value?.byteLength) continue;
              await appendSourceBuffer(sourceBuffer, value);
              if (!started) {
                started = true;
                await audio.play();
              }
            }

            if (gen !== _ttsGen) {
              reader.cancel().catch(() => {});
              finish();
              return;
            }
            if (sourceBuffer.updating) {
              await new Promise<void>((r) => sourceBuffer.addEventListener("updateend", () => r(), { once: true }));
            }
            if (mediaSource.readyState === "open") mediaSource.endOfStream();
          } catch (err) {
            fail(err);
          }
        })();
      },
      { once: true },
    );
  });
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
/*  STT                                                                       */
/* -------------------------------------------------------------------------- */

export type RecorderOptions = {
  onEnd?: () => void;
  onError?: (error: string) => void;
  silenceMs?: number;
  maxDurationMs?: number;
  noSpeechMs?: number;
};

export type RealtimeTranscriptionEndReason = "committed" | "manual" | "max" | "noSpeech" | "closed" | "error";

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
  let pendingChunks: Int16Array[] = [];
  let pendingSamples = 0;
  let ended = false;
  let heardSpeech = false;
  let committed = false;
  let firstChunk = true;
  let maxTriggered = false;
  const startedAt = performance.now();
  let noiseSamples = 0;
  let noiseAccum = 0;
  let noiseFloor = 0.005;

  const sendPending = (commit = false) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || pendingSamples <= 0) return;
    const pcm = concatPcm(pendingChunks, pendingSamples);
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

  const finish = (reason: RealtimeTranscriptionEndReason) => {
    if (ended) return;
    ended = true;
    try {
      processor?.disconnect();
      source?.disconnect();
      silentGain?.disconnect();
    } catch {
      /* ignore */
    }
    processor = null;
    source = null;
    silentGain = null;
    ctx?.close().catch(() => {});
    ctx = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    ws = null;
    if (_stopRealtime === stop) _stopRealtime = null;
    opts.onEnd?.(reason);
  };

  const commitAndFinish = (reason: RealtimeTranscriptionEndReason) => {
    if (ended) return;
    sendPending(true);
    window.setTimeout(() => finish(reason), 900);
  };

  const stop = () => {
    if (heardSpeech) commitAndFinish("manual");
    else finish("manual");
  };

  _stopRealtime = stop;

  const startAudioPump = () => {
    if (!ctx || !stream || !ws || ended) return;
    source = ctx.createMediaStreamSource(stream);
    processor = ctx.createScriptProcessor(4096, 1, 1);
    silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);

    processor.onaudioprocess = (event) => {
      if (!ws || ws.readyState !== WebSocket.OPEN || ended) return;
      const input = event.inputBuffer.getChannelData(0);
      const now = performance.now();

      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        sum += input[i] * input[i];
      }
      const rms = Math.sqrt(sum / input.length);

      if (now - startedAt < 500) {
        noiseAccum += rms;
        noiseSamples++;
        if (noiseSamples > 0) noiseFloor = noiseAccum / noiseSamples;
      } else {
        const dynamic = Math.max(noiseFloor + 0.006, noiseFloor * 1.6);
        const threshold = Math.min(0.03, Math.max(0.012, dynamic));
        if (rms > threshold) heardSpeech = true;
      }

      const pcm = floatToPcm16(resampleTo16k(input, ctx!.sampleRate));
      pendingChunks.push(pcm);
      pendingSamples += pcm.length;
      if (pendingSamples >= 1600) sendPending(false);

      if (!heardSpeech && now - startedAt > noSpeechMs) {
        finish("noSpeech");
        return;
      }
      if (!maxTriggered && now - startedAt > maxDurationMs) {
        maxTriggered = true;
        commitAndFinish("max");
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
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
          const type = String(payload.message_type || payload.type || "");
          if (type === "partial_transcript") {
            opts.onPartial?.(String(payload.text || ""));
          } else if (type === "committed_transcript" || type === "committed_transcript_with_timestamps") {
            const text = String(payload.text || "").trim();
            if (text) {
              committed = true;
              opts.onCommitted?.(text);
            }
            finish("committed");
          } else if (
            type.includes("error") ||
            [
              "auth_error",
              "quota_exceeded",
              "transcriber_error",
              "input_error",
              "commit_throttled",
              "unaccepted_terms",
              "rate_limited",
              "queue_overflow",
              "resource_exhausted",
              "session_time_limit_exceeded",
              "chunk_size_exceeded",
              "insufficient_audio_activity",
            ].includes(type)
          ) {
            opts.onError?.(describeRealtimeError(payload, `Realtime STT failed: ${type || "unknown error"}`));
            finish("error");
          }
        } catch {
          /* ignore malformed realtime messages */
        }
      };
      ws.onerror = () => {
        opts.onError?.("Realtime STT connection failed");
        finish("error");
      };
      ws.onclose = () => {
        finish(committed ? "committed" : "closed");
      };
    } catch (err: any) {
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
