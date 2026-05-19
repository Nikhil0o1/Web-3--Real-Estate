"use client";

/**
 * Silero VAD wrapper.
 *
 * Loads Silero V5 via @ricky0123/vad-web (onnxruntime-web). Assets are served
 * from `/vad/*` (copied to public/vad at install time).
 *
 * Two modes:
 *   - "primary": runs against an existing MediaStream that the STT pipeline
 *     is also reading. Emits speech-start, speech-end, frame events.
 *   - "barge-in": runs a separate Silero instance during assistant playback to
 *     detect the user trying to interrupt. Uses higher thresholds and a short
 *     redemption window so the audio cuts fast on confirmed speech.
 */

import { MicVAD, type RealTimeVADOptions } from "@ricky0123/vad-web";

// onnxruntime-web is loaded as external from CDN (global ORT)
const ort = typeof window !== "undefined" ? (window as any).ORT : null;

export type VadEvent =
  | { kind: "speech_start" }
  | { kind: "speech_real_start" }
  | { kind: "speech_end"; samples: Float32Array }
  | { kind: "misfire" }
  | { kind: "frame"; probability: number };

export type SileroVadHandle = {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
  setOptions: (update: Partial<RealTimeVADOptions>) => void;
  isListening: () => boolean;
};

export type SileroVadOptions = {
  /** Existing MediaStream to listen on. If absent, the VAD will request one. */
  stream?: MediaStream;
  /** Existing AudioContext to share with the rest of the pipeline. */
  audioContext?: AudioContext;
  /** v5 is more accurate; legacy is smaller. Default v5. */
  model?: "v5" | "legacy";
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  redemptionMs?: number;
  preSpeechPadMs?: number;
  minSpeechMs?: number;
  onEvent: (event: VadEvent) => void;
  onError?: (err: string) => void;
};

const VAD_ASSET_BASE = "/vad/";
const ORT_WASM_BASE = "/vad/";

let _ortConfigured = false;
function configureOrtOnce() {
  if (_ortConfigured) return;
  _ortConfigured = true;
  if (ort?.env?.wasm) {
    ort.env.wasm.wasmPaths = ORT_WASM_BASE;
    // Single thread keeps things simple and avoids cross-origin-isolation requirements.
    ort.env.wasm.numThreads = 1;
  }
}

export async function createSileroVad(opts: SileroVadOptions): Promise<SileroVadHandle> {
  configureOrtOnce();

  const sharedStream = opts.stream || null;

  const vad = await MicVAD.new({
    model: opts.model || "v5",
    baseAssetPath: VAD_ASSET_BASE,
    onnxWASMBasePath: ORT_WASM_BASE,
    audioContext: opts.audioContext,
    positiveSpeechThreshold: opts.positiveSpeechThreshold ?? 0.55,
    negativeSpeechThreshold: opts.negativeSpeechThreshold ?? 0.4,
    redemptionMs: opts.redemptionMs ?? 800,
    preSpeechPadMs: opts.preSpeechPadMs ?? 160,
    minSpeechMs: opts.minSpeechMs ?? 220,
    startOnLoad: false,
    submitUserSpeechOnPause: false,
    processorType: "auto",
    getStream: async () => {
      if (sharedStream) return sharedStream;
      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    },
    pauseStream: async () => {
      /* keep the shared stream alive — STT or the caller owns it */
    },
    resumeStream: async (stream) => stream,
    onSpeechStart: () => opts.onEvent({ kind: "speech_start" }),
    onSpeechRealStart: () => opts.onEvent({ kind: "speech_real_start" }),
    onSpeechEnd: (samples) => opts.onEvent({ kind: "speech_end", samples }),
    onVADMisfire: () => opts.onEvent({ kind: "misfire" }),
    onFrameProcessed: (probs) => {
      // Throttle frame callbacks — we only need the probability for UI/telemetry.
      opts.onEvent({ kind: "frame", probability: probs.isSpeech });
    },
  });

  return {
    start: () => vad.start(),
    pause: () => vad.pause(),
    destroy: () => vad.destroy(),
    setOptions: (update) => vad.setOptions(update),
    isListening: () => vad.listening,
  };
}
