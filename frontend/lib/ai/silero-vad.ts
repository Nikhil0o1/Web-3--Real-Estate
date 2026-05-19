"use client";

/**
 * Silero VAD stub.
 *
 * The original implementation used @ricky0123/vad-web + onnxruntime-web which
 * caused webpack/Terser build failures. ElevenLabs Scribe already has built-in
 * VAD (commit_strategy=vad), so we don't need client-side Silero.
 *
 * This stub provides the same interface but is a no-op. The voice-runtime
 * relies on ElevenLabs server-side VAD for speech detection.
 */

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
  setOptions: (update: Record<string, unknown>) => void;
  isListening: () => boolean;
};

export type SileroVadOptions = {
  stream?: MediaStream;
  audioContext?: AudioContext;
  model?: "v5" | "legacy";
  positiveSpeechThreshold?: number;
  negativeSpeechThreshold?: number;
  redemptionMs?: number;
  preSpeechPadMs?: number;
  minSpeechMs?: number;
  onEvent: (event: VadEvent) => void;
  onError?: (err: string) => void;
};

/**
 * No-op VAD stub. ElevenLabs Scribe handles VAD server-side.
 */
export async function createSileroVad(_opts: SileroVadOptions): Promise<SileroVadHandle> {
  return {
    start: async () => {},
    pause: async () => {},
    destroy: async () => {},
    setOptions: () => {},
    isListening: () => false,
  };
}
