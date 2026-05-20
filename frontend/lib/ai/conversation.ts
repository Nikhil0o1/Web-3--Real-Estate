/**
 * ChatGPT-style continuous duplex voice session.
 *
 * Lifecycle:
 *   start()  → grabs mic, opens AudioContext, opens WS, runs continuous VAD.
 *   stop()   → tears everything down cleanly.
 *
 * Per turn:
 *   - Mic stays open the whole session (never auto-stops on silence).
 *   - Local VAD watches the mic. When voice starts we capture a segment with
 *     MediaRecorder. When ~1.2s of silence follows speech, we close the segment,
 *     POST it to the HTTP STT endpoint, then send {"type":"intent"} over WS.
 *   - Backend streams text tokens AND PCM16 audio chunks back. We render text
 *     and schedule audio via Web Audio for gapless, low-latency playback.
 *   - Barge-in: if the user starts speaking *while* the AI is playing audio,
 *     we cancel playback, send {"type":"interrupt"}, and start a new segment.
 */
import { getApiBase, apiPostMultipart, getToken } from "@/lib/api";

type SessionState =
  | "idle"          // not started
  | "listening"     // mic open, no speech yet
  | "recording"     // capturing user speech
  | "transcribing"  // STT in flight
  | "thinking"      // LLM streaming reply
  | "speaking"      // TTS audio playing
  | "error";

type Callbacks = {
  onStateChange: (state: SessionState) => void;
  onToken: (token: string) => void;
  onTranscript: (text: string) => void;
  onActions?: (actions: any[]) => void;
  onLevel?: (level: number) => void; // 0..1 — for orb visualizer
  onError?: (msg: string) => void;
};

const VAD_THRESHOLD = 0.018;          // RMS above this counts as voice
const VAD_HANGOVER_MS = 1100;          // silence after speech ends a turn
const VAD_MIN_SPEECH_MS = 180;         // ignore micro-bursts
const VAD_BARGE_IN_RMS = 0.06;         // louder threshold to interrupt TTS
const MAX_SEGMENT_MS = 30_000;

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return "";
}

function fileExtForMime(mime: string): string {
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer);
  const len = buffer.byteLength / 2;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export class VoiceSessionManager {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: number = 0;

  // Recording
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private speakingStartedAt = 0;
  private lastVoiceAt = 0;
  private isCapturing = false;

  // Playback (PCM scheduling)
  private playheadAt = 0;
  private playbackSources: AudioBufferSourceNode[] = [];
  private ttsSampleRate = 16000;
  private aiPlaying = false;

  // State
  private state: SessionState = "idle";
  private callbacks: Callbacks;
  private stopped = false;

  constructor(callbacks: Callbacks) {
    this.callbacks = callbacks;
  }

  private setState(s: SessionState) {
    if (this.state === s) return;
    this.state = s;
    this.callbacks.onStateChange(s);
  }

  async start() {
    this.stopped = false;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.callbacks.onError?.("Microphone not available in this browser.");
      this.setState("error");
      return;
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (err: any) {
      this.callbacks.onError?.(err?.message || "Microphone permission denied.");
      this.setState("error");
      return;
    }

    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    try { await this.audioCtx.resume(); } catch { /* ignore */ }

    const source = this.audioCtx.createMediaStreamSource(this.micStream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    source.connect(this.analyser);

    this.openSocket();
    this.startVadLoop();
    this.setState("listening");
  }

  stop() {
    this.stopped = true;
    window.clearInterval(this.vadInterval);
    this.vadInterval = 0;
    this.stopPlayback();
    this.cancelCurrentRecorder();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      try { this.ws.close(); } catch { /* ignore */ }
    }
    this.ws = null;
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      this.audioCtx.close().catch(() => {});
    }
    this.audioCtx = null;
    this.analyser = null;
    this.setState("idle");
  }

  /** Manually send a text intent (e.g. typed input while voice session is open). */
  sendIntent(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.stopPlayback();
    this.setState("thinking");
    this.ws.send(JSON.stringify({ type: "intent", text }));
  }

  // ───────────────── WebSocket ─────────────────

  private openSocket() {
    const base = getApiBase();
    const token = getToken();
    let wsUrl = "";
    if (base.startsWith("http://")) {
      wsUrl = base.replace("http://", "ws://") + "/api/ai/voice/stream";
    } else if (base.startsWith("https://")) {
      wsUrl = base.replace("https://", "wss://") + "/api/ai/voice/stream";
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${protocol}//${window.location.host}${base}/api/ai/voice/stream`;
    }
    if (token) wsUrl += `?token=${encodeURIComponent(token)}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (e) => {
      let data: any;
      try { data = JSON.parse(e.data); } catch { return; }
      switch (data.type) {
        case "ready":
          if (typeof data.sample_rate === "number") this.ttsSampleRate = data.sample_rate;
          break;
        case "token":
          this.callbacks.onToken(data.text || "");
          break;
        case "audio":
          this.schedulePcmChunk(data.chunk || "", data.sample_rate || this.ttsSampleRate);
          break;
        case "audio_end":
          // Reset playhead so the next utterance starts immediately.
          break;
        case "complete":
          if (data.actions && this.callbacks.onActions) {
            this.callbacks.onActions(data.actions);
          }
          // If audio isn't actively playing, fall back to listening
          if (!this.aiPlaying && !this.isCapturing) this.setState("listening");
          break;
        case "interrupted":
          this.stopPlayback();
          this.setState("listening");
          break;
        case "error":
          this.callbacks.onError?.(data.detail || "Voice stream error");
          this.setState("error");
          break;
      }
    };

    this.ws.onerror = () => {
      this.callbacks.onError?.("Voice connection failed.");
      this.setState("error");
    };

    this.ws.onclose = () => {
      if (!this.stopped) {
        // Connection dropped unexpectedly — surface an error but keep the UI usable.
        this.setState("error");
      }
    };
  }

  // ───────────────── VAD loop ─────────────────

  private startVadLoop() {
    if (!this.analyser) return;
    const buffer = new Float32Array(this.analyser.fftSize);

    this.vadInterval = window.setInterval(() => {
      if (this.stopped || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(buffer);
      let sumSq = 0;
      for (let i = 0; i < buffer.length; i++) sumSq += buffer[i] * buffer[i];
      const rms = Math.sqrt(sumSq / buffer.length);
      this.callbacks.onLevel?.(Math.min(1, rms * 8));

      const now = performance.now();
      const isVoice = rms > VAD_THRESHOLD;
      const isLoudBarge = rms > VAD_BARGE_IN_RMS;

      // Barge-in: interrupt TTS if user starts talking loudly while AI is speaking.
      if (this.aiPlaying && isLoudBarge) {
        this.interrupt();
      }

      if (this.isCapturing) {
        if (isVoice) this.lastVoiceAt = now;
        const sinceSpeech = now - this.lastVoiceAt;
        const totalLen = now - this.speakingStartedAt;
        if (sinceSpeech > VAD_HANGOVER_MS || totalLen > MAX_SEGMENT_MS) {
          this.endRecording();
        }
      } else if (isVoice && (this.state === "listening" || this.state === "speaking")) {
        // Start capturing only if we're idle in listening (or just barged in).
        if (this.aiPlaying) this.interrupt();
        this.startRecording(now);
      }
    }, 80);
  }

  // ───────────────── Recording ─────────────────

  private startRecording(now: number) {
    if (!this.micStream) return;
    this.speakingStartedAt = now;
    this.lastVoiceAt = now;
    this.chunks = [];
    this.isCapturing = true;
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(this.micStream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => this.finalizeRecording();
    try {
      this.recorder.start(250);
      this.setState("recording");
    } catch (err) {
      this.isCapturing = false;
      this.recorder = null;
    }
  }

  private endRecording() {
    if (!this.recorder) {
      this.isCapturing = false;
      return;
    }
    if (this.recorder.state !== "inactive") {
      try { this.recorder.stop(); } catch { /* ignore */ }
    }
  }

  private cancelCurrentRecorder() {
    this.isCapturing = false;
    this.chunks = [];
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      try { this.recorder.stop(); } catch { /* ignore */ }
    }
    this.recorder = null;
  }

  private async finalizeRecording() {
    const speechDuration = performance.now() - this.speakingStartedAt;
    const recorder = this.recorder;
    const chunks = this.chunks;
    this.recorder = null;
    this.chunks = [];
    this.isCapturing = false;

    if (this.stopped || chunks.length === 0 || speechDuration < VAD_MIN_SPEECH_MS) {
      this.setState("listening");
      return;
    }

    const mime = recorder?.mimeType || "audio/webm";
    const blob = new Blob(chunks, { type: mime });
    this.setState("transcribing");

    try {
      const ext = fileExtForMime(mime);
      const form = new FormData();
      form.append("file", blob, `speech.${ext}`);
      const res = await apiPostMultipart<{ text: string }>("/api/ai/voice/transcribe", form);
      const text = (res?.text || "").trim();
      if (text) {
        this.callbacks.onTranscript(text);
        this.sendIntent(text);
      } else {
        this.setState("listening");
      }
    } catch (err: any) {
      this.callbacks.onError?.(err?.message || "Transcription failed.");
      this.setState("listening");
    }
  }

  // ───────────────── Playback (PCM scheduling) ─────────────────

  private schedulePcmChunk(b64: string, sampleRate: number) {
    if (!this.audioCtx || !b64) return;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const float = pcm16ToFloat32(bytes.buffer);
    if (float.length === 0) return;

    const ctx = this.audioCtx;
    const buffer = ctx.createBuffer(1, float.length, sampleRate);
    buffer.getChannelData(0).set(float);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(this.playheadAt, now + 0.02);
    src.start(startAt);
    this.playheadAt = startAt + buffer.duration;
    this.aiPlaying = true;
    this.setState("speaking");

    src.onended = () => {
      this.playbackSources = this.playbackSources.filter((s) => s !== src);
      if (this.playbackSources.length === 0 && ctx.currentTime >= this.playheadAt - 0.01) {
        this.aiPlaying = false;
        if (!this.isCapturing) this.setState("listening");
      }
    };
    this.playbackSources.push(src);
  }

  private stopPlayback() {
    this.playbackSources.forEach((s) => {
      try { s.stop(); } catch { /* ignore */ }
      try { s.disconnect(); } catch { /* ignore */ }
    });
    this.playbackSources = [];
    if (this.audioCtx) this.playheadAt = this.audioCtx.currentTime;
    this.aiPlaying = false;
  }

  private interrupt() {
    this.stopPlayback();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
  }
}
