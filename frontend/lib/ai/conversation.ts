import { getApiBase, apiPostMultipart, getToken } from "@/lib/api";

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

export class VoiceSessionManager {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  
  // VAD & Recording
  private analyser: AnalyserNode | null = null;
  private watchHandle: number = 0;
  private VAD_THRESHOLD = 0.012; 
  private SILENCE_HOLD_MS = 1200;
  private lastVoiceAt: number = 0;
  
  private curState: "idle" | "listening" | "recording" | "transcribing" | "speaking" | "interrupted" | "thinking" = "idle";
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: BlobPart[] = [];
  
  // Playback
  private playbackQueue: Float32Array[] = [];
  private isPlaying = false;
  private activeSource: AudioBufferSourceNode | null = null;
  
  // Callbacks
  private onStateChange: (state: string) => void;
  private onToken: (token: string) => void;
  private onTranscript: (text: string) => void;
  private onActions?: (actions: any[]) => void;
  
  constructor(callbacks: {
    onStateChange: (state: string) => void;
    onToken: (token: string) => void;
    onTranscript: (text: string) => void;
    onActions?: (actions: any[]) => void;
  }) {
    this.onStateChange = callbacks.onStateChange;
    this.onToken = callbacks.onToken;
    this.onTranscript = callbacks.onTranscript;
    this.onActions = callbacks.onActions;
  }
  
  private updateState(s: typeof this.curState) {
    if (this.curState !== s) {
      console.log("[VoiceSessionManager] State transition:", this.curState, "->", s);
    }
    this.curState = s;
    this.onStateChange(s);
  }

  async start() {
    this.updateState("listening");
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000
      });
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        }
      });
      console.log("Mic acquired.");
    } catch (err) {
      console.error("Mic failed:", err);
      this.onStateChange("error");
      return;
    }

    // Connect to websocket
    const base = getApiBase();
    let wsUrl = "";
    if (base.startsWith("http://")) {
      wsUrl = base.replace("http://", "ws://") + "/api/ai/voice/stream";
    } else if (base.startsWith("https://")) {
      wsUrl = base.replace("https://", "wss://") + "/api/ai/voice/stream";
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${protocol}//${window.location.host}${base}/api/ai/voice/stream`;
    }
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log("Duplex WS opened");
      this.startMicProcessing();
    };
    
    this.ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("[VoiceSessionManager] Received message type:", data.type);
        if (data.type === "token") {
          this.onToken(data.text);
        } else if (data.type === "audio") {
          await this.queueAudio(data.chunk);
        } else if (data.type === "complete") {
          console.log("[VoiceSessionManager] Complete message received, reply:", data.reply, "actions:", data.actions);
          if (data.actions && this.onActions) {
            this.onActions(data.actions);
          }
          // Transition back to listening state after complete, regardless of audio queue
          if (this.curState === "thinking" || this.curState === "speaking") {
            this.updateState("listening");
          }
        }
      } catch (err) {
        console.error("[VoiceSessionManager] Message parse error:", err);
      }
    };
    
    this.ws.onerror = () => this.onStateChange("error");
    this.ws.onclose = () => {
      if (this.curState !== "idle") this.updateState("idle");
    };
  }
  
  private startMicProcessing() {
    if (!this.audioCtx || !this.micStream) return;
    
    const source = this.audioCtx.createMediaStreamSource(this.micStream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    
    const buffer = new Float32Array(this.analyser.fftSize);
    
    this.watchHandle = window.setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(buffer);
      
      let sumSq = 0;
      for (let i=0; i < buffer.length; i++) sumSq += buffer[i]*buffer[i];
      const rms = Math.sqrt(sumSq / buffer.length);
      const now = performance.now();
      
      // VAD logic
      if (rms > this.VAD_THRESHOLD) {
        this.lastVoiceAt = now;
        
        if (this.curState === "listening" || this.curState === "speaking") {
          if (this.isPlaying) {
            this.interrupt();
          }
          this._startRecording();
        }
      }
      
      if (this.curState === "recording" && (now - this.lastVoiceAt > this.SILENCE_HOLD_MS)) {
        this._stopRecordingAndTranscribe();
      }
      
    }, 100);
  }
  
  private _startRecording() {
    if (!this.micStream) return;
    this.updateState("recording");
    this.audioChunks = [];
    
    const mimeType = pickMimeType();
    this.mediaRecorder = new MediaRecorder(this.micStream, mimeType ? { mimeType } : undefined);
    
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.audioChunks.push(e.data);
    };
    
    this.mediaRecorder.start(250);
  }
  
  private _stopRecordingAndTranscribe() {
    if (!this.mediaRecorder || this.mediaRecorder.state === "inactive") return;
    
    this.updateState("transcribing");
    
    this.mediaRecorder.onstop = async () => {
      if (this.audioChunks.length === 0) {
        this.updateState("listening");
        return;
      }
      
      const type = this.mediaRecorder?.mimeType || "audio/webm";
      const blob = new Blob(this.audioChunks, { type });
      this.audioChunks = [];
      
      try {
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const form = new FormData();
        form.append("file", blob, `speech.${ext}`);
        
        const res = await apiPostMultipart<{ text: string }>("/api/ai/voice/transcribe", form);
        const text = (res?.text || "").trim();
        
        if (text) {
          this.onTranscript(text);
          this.sendIntent(text);
        } else {
          this.updateState("listening");
        }
      } catch (err) {
        console.error("Transcribe failed", err);
        this.updateState("listening");
      }
    };
    
    this.mediaRecorder.stop();
  }
  
  sendIntent(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.curState !== "interrupted") {
          this.onStateChange("thinking"); 
      }
      this.ws.send(JSON.stringify({ type: "intent", text }));
    }
  }

  private interrupt() {
    console.log("Barge-in detected, stopping current TTS");
    this.playbackQueue = [];
    this.isPlaying = false;
    
    if (this.activeSource) {
      try { this.activeSource.stop(); } catch (e) {}
      this.activeSource = null;
    }
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
    this.updateState("interrupted");
  }

  private async queueAudio(base64Chunk: string) {
    const binary = atob(base64Chunk);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    
    if (!this.audioCtx) return;
    try {
      const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer);
      this.playbackQueue.push(audioBuffer.getChannelData(0));
      if (!this.isPlaying && this.curState !== "recording") {
        this.updateState("speaking");
        this.playNext();
      }
    } catch(e) {
      console.error("Audio decode error", e);
    }
  }

  private playNext() {
    if (this.playbackQueue.length === 0 || !this.audioCtx || this.curState === "recording") {
      this.isPlaying = false;
      if (this.curState === "speaking") {
        this.updateState("listening");
      }
      return;
    }
    
    this.isPlaying = true;
    const chunkData = this.playbackQueue.shift()!;
    
    const audioBuffer = this.audioCtx.createBuffer(1, chunkData.length, this.audioCtx.sampleRate);
    audioBuffer.getChannelData(0).set(chunkData);
    
    this.activeSource = this.audioCtx.createBufferSource();
    this.activeSource.buffer = audioBuffer;
    this.activeSource.connect(this.audioCtx.destination);
    
    this.activeSource.onended = () => {
      this.activeSource = null;
      this.playNext();
    };
    
    this.activeSource.start();
  }

  stop() {
    window.clearInterval(this.watchHandle);
    
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    
    if (this.activeSource) {
      try { this.activeSource.stop(); } catch(e){}
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      try { this.audioCtx.close(); } catch(e){}
      this.audioCtx = null;
    }
    
    this.updateState("idle");
  }
}