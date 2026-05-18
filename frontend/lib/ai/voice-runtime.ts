"use client";

/**
 * Centralized voice runtime.
 *
 * All speech and microphone lifecycle goes through here.
 *
 * TTS: Backend OpenAI TTS (gpt-4o-mini-tts). Browser-native SpeechSynthesis
 *      is the fallback when the backend call fails.
 *
 * STT: Browser MediaRecorder -> backend OpenAI Whisper. Web Speech API is
 *      kept as a no-backend fallback.
 */

import { aiSpeak } from "./api";

/* -------------------------------------------------------------------------- */
/*  TTS — backend ElevenLabs primary path                                     */
/* -------------------------------------------------------------------------- */

let _audioUnlocked = false;
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
  return () => {
    _speakingListeners.delete(cb);
  };
}

export function isSpeaking() {
  return _speaking;
}

/** Must be called from a real user gesture to allow future audio.play(). */
export function unlockAudio() {
  if (typeof window === "undefined" || _audioUnlocked) return;
  try {
    const a = new Audio();
    a.muted = true;
    a.src =
      "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA//////////////////////////8AAAA8TEFNRTMuMTAwAc0AAAAAAAAAABRgJAJAQgAAYAAAASAaW4D3LAAAAAAAAAAAAAAAAA";
    void a.play().then(() => {
      _audioUnlocked = true;
      a.pause();
    });
  } catch {
    /* ignore */
  }
}

function cancelSpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  setSpeaking(false);
}

function pickVoice(voices: SpeechSynthesisVoice[], gender: "male" | "female"): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = en.length ? en : voices;
  if (!pool.length) return null;
  const g = gender === "male";
  const maleHints = /male|daniel|fred|david|alex|arthur|aaron|james|john|mark|microsoft david|google uk english male/i;
  const femaleHints = /female|samantha|karen|victoria|zira|susan|sarah|hazel|martha|google uk english female|microsoft zira/i;
  for (const v of pool) {
    const id = `${v.name} ${v.voiceURI}`.toLowerCase();
    if (g && maleHints.test(id)) return v;
    if (!g && femaleHints.test(id)) return v;
  }
  return pool[g ? Math.floor(pool.length / 2) : 0] ?? pool[0] ?? null;
}

function browserSpeak(text: string, rate = 1, gender: "male" | "female" = "female"): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      resolve();
      return;
    }
    cancelSpeech();
    try {
      window.speechSynthesis.resume();
    } catch {
      /* ignore */
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.lang = "en-US";

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      setSpeaking(false);
      resolve();
    };
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = settle;
    utterance.onerror = settle;

    const estimateMs = Math.min(30_000, Math.max(3_000, text.length * 95));
    window.setTimeout(settle, estimateMs);

    const apply = () => {
      const voices = window.speechSynthesis.getVoices();
      const v = pickVoice(voices, gender);
      if (v) utterance.voice = v;
    };
    apply();
    const voicesNow = window.speechSynthesis.getVoices();
    const kick = () => {
      try {
        setSpeaking(true);
        window.speechSynthesis.speak(utterance);
        // Chromium pauses long utterances ~15s; keep-alive every 4s.
        const keepAlive = window.setInterval(() => {
          if (settled) {
            window.clearInterval(keepAlive);
            return;
          }
          try {
            if (window.speechSynthesis.paused) window.speechSynthesis.resume();
          } catch {
            /* ignore */
          }
        }, 4000);
      } catch {
        settle();
      }
    };
    if (voicesNow.length === 0) {
      const onVoices = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
        apply();
        kick();
      };
      window.speechSynthesis.addEventListener("voiceschanged", onVoices);
      window.setTimeout(() => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
        apply();
        kick();
      }, 400);
      return;
    }
    kick();
  });
}

/** Speak text. Primary: backend ElevenLabs TTS. Fallback: browser SpeechSynthesis. */
export async function speak(text: string, onComplete?: () => void) {
  if (typeof window === "undefined" || !text.trim()) {
    onComplete?.();
    return;
  }
  const t = text.trim();
  try {
    const audioBuffer = await aiSpeak({ text: t });
    const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    setSpeaking(true);
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
        reject(new Error("Audio playback failed"));
      };
      void audio.play().catch(reject);
    });
  } catch {
    // Fallback to browser-native speech synthesis
    await browserSpeak(t);
  }
  onComplete?.();
}

/* -------------------------------------------------------------------------- */
/*  STT — MediaRecorder + Whisper (primary) / Web Speech API (fallback)     */
/* -------------------------------------------------------------------------- */

export type SpeechResult = {
  transcript: string;
  isFinal: boolean;
  confidence: number;
};

export type RecorderOptions = {
  onResult?: (result: SpeechResult) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
  silenceMs?: number; // ms of silence after speech to stop (default 2500)
  maxDurationMs?: number; // hard cap (default 30000)
  noSpeechMs?: number; // how long to wait for first speech (default 15000)
};

let _recorder: MediaRecorder | null = null;
let _stream: MediaStream | null = null;
let _chunks: Blob[] = [];
let _vadFrame: number | null = null;
let _audioCtx: AudioContext | null = null;

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

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of opts) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

/** Start recording audio with VAD. Returns a stop function. */
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

      // AudioContext for VAD
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
          // Drop captured audio so the caller treats this as silence.
          _chunks = [];
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

        // Short calibration — first 400ms to measure ambient noise.
        if (now - startedAt < 400) {
          noiseAccum += rms;
          noiseSamples++;
          if (noiseSamples > 0) noiseFloor = noiseAccum / noiseSamples;
          _vadFrame = requestAnimationFrame(tick);
          return;
        }
        if (calibratedAt === 0) calibratedAt = now;

        // Sensitive threshold: max(noise + 0.006, noise * 1.6, absolute 0.012).
        // Capped at 0.03 so a noisy environment can't make speech unreachable.
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
      const message = err?.message || err?.name || "Microphone access denied";
      opts.onError?.(message);
      cleanupRecorder();
    });

  // Return stop function
  return () => {
    cancelled = true;
    cleanupRecorder();
  };
}

/** Get the recorded blob (call after onEnd fires). */
export function getRecordedBlob(): Blob | null {
  if (!_chunks.length) return null;
  const mime = pickMime() || "audio/webm";
  return new Blob(_chunks, { type: mime });
}

/* -------------------------------------------------------------------------- */
/*  Web Speech API fallback (legacy STT)                                      */
/* -------------------------------------------------------------------------- */

interface LegacyRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export function legacySpeechAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function startLegacyRecognition(opts: {
  onResult: (text: string, isFinal: boolean) => void;
  onError?: (msg: string) => void;
  onEnd?: () => void;
}): () => void {
  const w = window as any;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return () => {};
  cancelSpeech();
  const rec = new Ctor() as LegacyRecognition;
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = "en-US";
  rec.onresult = (event: unknown) => {
    const ev = event as { resultIndex: number; results: Array<{ 0: { transcript: string }; isFinal: boolean }> };
    const chunks: string[] = [];
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const text = String(ev.results[i]![0]!.transcript ?? "").trim();
      if (text) chunks.push(text);
    }
    const final = chunks.join(" ").trim();
    if (final) opts.onResult(final, true);
  };
  rec.onerror = () => {
    opts.onError?.("Speech recognition error");
  };
  rec.onend = () => {
    opts.onEnd?.();
  };
  rec.start();
  return () => rec.stop();
}
