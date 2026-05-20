"use client";

/**
 * Silero VAD wrapper.
 *
 * Wraps @ricky0123/vad-web (ONNX-based Silero VAD running in a Web Worker) so
 * the rest of the voice runtime sees a stable, narrow API. Silero replaces the
 * RMS-amplitude heuristic that was firing on doors, keyboards, laughs, music
 * etc. — Silero classifies frames as speech vs. non-speech with ~95% accuracy.
 *
 * Per-segment we surface the mean speech probability so the runtime can apply
 * a stricter gate while the AI is talking (echo-cancellation belt-and-braces).
 *
 * The library hosts its ONNX assets on jsDelivr by default; flip `baseAssetPath`
 * + `onnxWASMBasePath` to `/workers/vad/` and copy the files into
 * `frontend/public/workers/vad/` if you want fully self-hosted (offline) assets.
 */

export type SpeechSegment = {
  /** Captured speech audio at 16 kHz, mono, Float32. */
  audio: Float32Array;
  /** Mean Silero speech probability across the segment (0..1). */
  avgConfidence: number;
  /** Duration of the speech segment in ms (excluding pre-pad). */
  durationMs: number;
};

export type SileroVadOptions = {
  stream: MediaStream;
  /** Frames must score above this prob to count as speech. Default 0.85. */
  positiveSpeechThreshold?: number;
  /** Frames below this prob break out of a speech segment. Default 0.5. */
  negativeSpeechThreshold?: number;
  /** Minimum sustained speech frames to fire onSpeechEnd. 11 ≈ 352 ms. */
  minSpeechFrames?: number;
  /** Frames of silence before declaring end-of-speech. 8 ≈ 256 ms. */
  redemptionFrames?: number;
  /** Pre-speech padding frames included in the captured audio. */
  preSpeechPadFrames?: number;
  onSpeechStart?: () => void;
  onSpeechEnd?: (segment: SpeechSegment) => void;
  /** Fires for every processed frame (~32 ms). Useful for live level + barge-in. */
  onFrame?: (prob: number) => void;
  /** Sub-minSpeechFrames bursts (clicks, coughs). Treat as discardable. */
  onMisfire?: () => void;
};

const FRAME_MS = 32; // Silero v5 frame size at 16 kHz

export class SileroVad {
  private opts: SileroVadOptions;
  private vad: any = null;
  private destroyed = false;
  private confSum = 0;
  private confFrames = 0;

  constructor(opts: SileroVadOptions) {
    this.opts = opts;
  }

  /** Lazy-load the worker + ONNX runtime and start the VAD. */
  async start(): Promise<void> {
    if (this.destroyed) return;
    const mod = await import("@ricky0123/vad-web");
    if (this.destroyed) return;

    const positive = this.opts.positiveSpeechThreshold ?? 0.85;
    const negative = this.opts.negativeSpeechThreshold ?? 0.5;
    const minSpeechFrames = this.opts.minSpeechFrames ?? 11;
    const redemption = this.opts.redemptionFrames ?? 8;
    const preSpeechPad = this.opts.preSpeechPadFrames ?? 8;

    // Cast: the published @ricky0123/vad-web types omit `stream`, but the
    // runtime accepts it (and we use it so the library shares our existing
    // MediaStream instead of opening a second mic / prompting again).
    const micOpts: any = {
      stream: this.opts.stream,
      positiveSpeechThreshold: positive,
      negativeSpeechThreshold: negative,
      minSpeechFrames,
      redemptionFrames: redemption,
      preSpeechPadFrames: preSpeechPad,
      // CDN-hosted assets — see file header for self-host instructions.
      baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.24/dist/",
      onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/",
      onSpeechStart: () => {
        this.confSum = 0;
        this.confFrames = 0;
        this.opts.onSpeechStart?.();
      },
      onFrameProcessed: (probs: { isSpeech: number; notSpeech: number }) => {
        const p = probs?.isSpeech ?? 0;
        this.confSum += p;
        this.confFrames++;
        this.opts.onFrame?.(p);
      },
      onSpeechEnd: (audio: Float32Array) => {
        const frames = this.confFrames || 1;
        const avg = this.confSum / frames;
        const durationMs = Math.max(0, frames * FRAME_MS);
        this.confSum = 0;
        this.confFrames = 0;
        this.opts.onSpeechEnd?.({ audio, avgConfidence: avg, durationMs });
      },
      onVADMisfire: () => {
        this.confSum = 0;
        this.confFrames = 0;
        this.opts.onMisfire?.();
      },
    };
    this.vad = await mod.MicVAD.new(micOpts);

    if (this.destroyed) {
      try { this.vad.destroy?.(); } catch { /* ignore */ }
      this.vad = null;
      return;
    }

    this.vad.start();
  }

  pause(): void {
    try { this.vad?.pause?.(); } catch { /* ignore */ }
  }

  resume(): void {
    try { this.vad?.start?.(); } catch { /* ignore */ }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    try { this.vad?.pause?.(); } catch { /* ignore */ }
    try { await this.vad?.destroy?.(); } catch { /* ignore */ }
    this.vad = null;
  }
}

/** Encode Float32 PCM at the given sample rate into a 16-bit WAV blob. */
export function floatToWavBlob(audio: Float32Array, sampleRate: number): Blob {
  const numSamples = audio.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);            // block align
  view.setUint16(34, 16, true);           // bits per sample
  writeStr(36, "data");
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}
