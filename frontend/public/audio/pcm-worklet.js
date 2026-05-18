/**
 * PCM resampler AudioWorklet processor.
 *
 * Receives Float32 audio frames at the AudioContext's native sample rate,
 * resamples to 16 kHz with linear interpolation, packs into Int16 LE chunks
 * of `chunkSamples` samples each, and posts the raw ArrayBuffer back to the
 * main thread. Maintains phase continuity across processing blocks.
 *
 * Replaces the legacy ScriptProcessorNode. Lower latency, off-main-thread.
 */

class PcmWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetRate || 16000;
    this.chunkSamples = opts.chunkSamples || 800; // 50 ms @ 16 kHz
    this.ratio = sampleRate / this.targetRate; // global `sampleRate` of the worklet
    this.outputBuffer = new Int16Array(this.chunkSamples);
    this.outputIndex = 0;
    this.accumulator = new Float32Array(0);
    this.readOffset = 0;
    this.muted = false;

    this.port.onmessage = (ev) => {
      const data = ev.data || {};
      if (data.type === "mute") {
        this.muted = !!data.muted;
      } else if (data.type === "flush") {
        if (this.outputIndex > 0) {
          const partial = new Int16Array(this.outputIndex);
          partial.set(this.outputBuffer.subarray(0, this.outputIndex));
          this.port.postMessage(partial.buffer, [partial.buffer]);
          this.outputIndex = 0;
        }
      } else if (data.type === "reset") {
        this.accumulator = new Float32Array(0);
        this.readOffset = 0;
        this.outputIndex = 0;
      }
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0 || this.muted) return true;

    // Append the new block to whatever tail we kept from the previous block.
    if (this.accumulator.length === 0) {
      this.accumulator = channel.slice();
    } else {
      const next = new Float32Array(this.accumulator.length + channel.length);
      next.set(this.accumulator, 0);
      next.set(channel, this.accumulator.length);
      this.accumulator = next;
    }

    let readPos = this.readOffset;
    const acc = this.accumulator;

    // Produce output samples while we have at least 2 input samples to interpolate.
    while (readPos + 1 < acc.length) {
      const idx = readPos | 0;
      const frac = readPos - idx;
      const s0 = acc[idx];
      const s1 = acc[idx + 1];
      const sample = s0 + (s1 - s0) * frac;
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      this.outputBuffer[this.outputIndex++] =
        clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
      if (this.outputIndex >= this.chunkSamples) {
        // Copy out and transfer ownership to avoid GC pressure.
        const out = new Int16Array(this.chunkSamples);
        out.set(this.outputBuffer);
        this.port.postMessage(out.buffer, [out.buffer]);
        this.outputIndex = 0;
      }
      readPos += this.ratio;
    }

    // Slide the accumulator forward by the integer part of readPos, keep the
    // fractional remainder so interpolation phase is preserved across blocks.
    const consumed = readPos | 0;
    if (consumed > 0) {
      this.accumulator = acc.subarray(consumed).slice();
    }
    this.readOffset = readPos - consumed;

    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorkletProcessor);
