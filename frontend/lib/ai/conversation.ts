import { getApiBase } from "@/lib/api";

export class VoiceSessionManager {
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  
  private playbackQueue: Float32Array[] = [];
  private isPlaying = false;
  
  private onStateChange: (state: string) => void;
  private onToken: (token: string) => void;
  private onTranscript: (text: string) => void;
  private onActions?: (actions: any[]) => void;
  
  private VAD_THRESHOLD = 0.01;
  private talking = false;
  
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

  async start() {
    this.onStateChange("connecting");
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
      this.onStateChange("listening");
      this.startMicProcessing();
    };
    
    this.ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "token") {
          this.onToken(data.text);
        } else if (data.type === "audio") {
          this.queueAudio(data.chunk);
        } else if (data.type === "complete") {
          if (data.actions && this.onActions) {
            this.onActions(data.actions);
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    
    this.ws.onerror = () => this.onStateChange("error");
    this.ws.onclose = () => this.onStateChange("idle");
  }
  
  private startMicProcessing() {
    if (!this.audioCtx || !this.micStream) return;
    
    this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
    this.scriptNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
    
    this.scriptNode.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      
      // Simple VAD based on RMS
      let sumSq = 0;
      for (let i=0; i<input.length; i++) sumSq += input[i]*input[i];
      const rms = Math.sqrt(sumSq / input.length);
      
      if (rms > this.VAD_THRESHOLD) {
        if (!this.talking) {
          this.talking = true;
          // Barge-in detected
          if (this.isPlaying) {
            this.interrupt();
          }
        }
        // In a real STT implementation, we would send audio bytes here
        // this.ws.send(e.inputBuffer.getChannelData(0));
      } else {
        if (this.talking) {
          this.talking = false;
          // For demo purposes, we will trigger a mock completion
          // if we were sending bytes.
          // In real implementation, ElevenLabs STT sends `{isFinal: true, text: "..."}`
        }
      }
    };
    
    this.micSource.connect(this.scriptNode);
    this.scriptNode.connect(this.audioCtx.destination);
  }
  
  // We mock the user sending text to initiate LangGraph flow
  sendIntent(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.onStateChange("processing");
      this.ws.send(JSON.stringify({ type: "intent", text }));
    }
  }

  private interrupt() {
    console.log("Barge-in detected, stopping current TTS");
    this.playbackQueue = [];
    this.isPlaying = false;
    this.onStateChange("interrupted");
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
    setTimeout(() => this.onStateChange("listening"), 300);
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
      // Decode MP3 audio from backend
      const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer);
      this.playbackQueue.push(audioBuffer.getChannelData(0));
      this.onStateChange("speaking");
      this.playNext();
    } catch(e) {
      console.error(e);
    }
  }

  private playNext() {
    if (this.isPlaying || this.playbackQueue.length === 0 || !this.audioCtx) return;
    
    this.isPlaying = true;
    const chunkData = this.playbackQueue.shift()!;
    
    const audioBuffer = this.audioCtx.createBuffer(1, chunkData.length, this.audioCtx.sampleRate);
    audioBuffer.getChannelData(0).set(chunkData);
    
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioCtx.destination);
    
    source.onended = () => {
      this.isPlaying = false;
      if (this.playbackQueue.length > 0) {
        this.playNext();
      } else {
        this.onStateChange("listening");
      }
    };
    source.start();
  }

  stop() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx && this.audioCtx.state !== 'closed') {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.onStateChange("idle");
  }
}