"use client";

/**
 * Barge-in controller.
 *
 * Runs a dedicated Silero VAD instance against the microphone while the
 * assistant is speaking. On confirmed user speech, calls `onInterrupt()` which
 * is wired to: (1) stop the current TTS session, (2) clear the audio queue,
 * (3) re-arm the STT pipeline to capture the user.
 *
 * Notes:
 *   - Requires the mic to remain open while playback runs. Browser
 *     `echoCancellation: true` lets the mic ignore the speaker's own audio,
 *     but only on most devices — laptop speakers at high volume can still
 *     leak. The positive threshold is set high (0.7) and minSpeechMs raised
 *     (350ms) to reduce false interrupts from echo.
 *   - The same MediaStream can be passed in for sharing with the primary STT.
 */

import { createSileroVad, type SileroVadHandle } from "./silero-vad";
import { mark } from "./telemetry";

export type BargeInOptions = {
  /** Reuse an existing mic stream/context to avoid double-acquiring the mic. */
  stream?: MediaStream;
  audioContext?: AudioContext;
  /** Fires once when user speech is confirmed during playback. */
  onInterrupt: () => void;
  /** Optional: surface the live probability for UI debugging. */
  onProbability?: (p: number) => void;
  /** Optional trace id for telemetry. */
  traceId?: string;
};

export type BargeInHandle = {
  stop: () => Promise<void>;
};

export async function startBargeInWatcher(opts: BargeInOptions): Promise<BargeInHandle> {
  let fired = false;
  let vad: SileroVadHandle | null = null;

  vad = await createSileroVad({
    stream: opts.stream,
    audioContext: opts.audioContext,
    model: "v5",
    // Stricter than the primary VAD — we only want to fire on confident speech.
    positiveSpeechThreshold: 0.7,
    negativeSpeechThreshold: 0.5,
    minSpeechMs: 350,
    redemptionMs: 250,
    preSpeechPadMs: 0,
    onEvent: (event) => {
      if (event.kind === "frame") {
        opts.onProbability?.(event.probability);
        return;
      }
      if (event.kind === "speech_real_start" && !fired) {
        fired = true;
        mark(opts.traceId ?? null, "barge_in");
        opts.onInterrupt();
      }
    },
    onError: (err) => {
      console.warn("[barge-in] vad error:", err);
    },
  });

  await vad.start();

  return {
    async stop() {
      try {
        await vad?.pause();
        await vad?.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}
