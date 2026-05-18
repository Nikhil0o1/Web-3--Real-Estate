"use client";

/**
 * Clean voice runtime — ElevenLabs TTS + ElevenLabs Scribe STT.
 *
 * TTS: Backend ElevenLabs via /api/ai/voice/speak (returns MP3).
 * STT: Browser MediaRecorder -> backend ElevenLabs Scribe via /api/ai/voice/transcribe.
 *
 * No legacy Web Speech API. No browser TTS fallback.
 */

import { aiSpeak } from "./api";

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

/** Cancel any playing audio. */
export function cancelSpeech() {
  // The Audio element handles itself when we stop speaking.
  setSpeaking(false);
}

/** Speak text using backend ElevenLabs TTS. Returns when audio finishes. */
export async function speak(text: string): Promise<void> {
  if (typeof window === "undefined" || !text.trim()) return;
  const t = text.trim();

  const audioBuffer = await aiSpeak({ text: t });
  const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  setSpeaking(true);
  try {
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Audio playback failed"));
      };
      void audio.play().catch(reject);
    });
  } finally {
    setSpeaking(false);
  }
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

let _recorder: MediaRecorder | null = null;
let _stream: MediaStream | null = null;
let _chunks: Blob[] = [];
let _vadFrame: number | null = null;
let _audioCtx: AudioContext | null = null;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of opts) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
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
