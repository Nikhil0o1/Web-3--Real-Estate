"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Mic, MicOff, Send, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { executeWorkflowActions } from "@/lib/workflows/action-runtime";
import { useWorkflowRuntimeStore } from "@/lib/workflows/workflow-runtime-store";
import type { DashboardRole } from "@/lib/workflows/types";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { cancelWorkflowSpeech, speakWorkflowAssistant, subscribeSpeakingState, unlockWorkflowAudio } from "@/lib/workflows/workflow-speech";
import { invokeWorkflowVoiceContinuation, registerWorkflowVoiceContinuation } from "@/lib/workflows/workflow-voice-bridge";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of opts) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

const VOICE_FILLER_WORDS = new Set([
  "ok",
  "okay",
  "yeah",
  "yep",
  "no",
  "nah",
  "uh",
  "um",
  "hmm",
  "hey",
  "hi",
  "hello",
  "thanks",
  "thank you",
  "please",
  "right",
  "sure",
]);

const NUMERIC_FIELDS = new Set([
  "property_id",
  "token_amount",
  "total_value",
  "token_supply",
  "monthly_rent_eth",
]);

const NUMBER_WORD_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)\b/i;

function nextWorkflowMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `wf-msg-${crypto.randomUUID()}`;
  return `wf-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendAssistantMessage(text: string) {
  useWorkflowRuntimeStore.setState((state) => ({
    messages: [
      ...state.messages,
      {
        id: nextWorkflowMessageId(),
        role: "assistant",
        content: text,
        createdAt: new Date().toISOString(),
      },
    ],
  }));
}

function shouldRejectTranscript(text: string, activeField: string | null): string | null {
  const cleaned = text.trim();
  if (!cleaned) return "Please repeat again.";
  const lower = cleaned.toLowerCase();
  const alnum = lower.replace(/[^a-z0-9]/g, "");
  if (!alnum) return "Please repeat again.";

  const field = (activeField || "").toLowerCase();
  if (VOICE_FILLER_WORDS.has(lower)) return "Please repeat again.";

  if (field && NUMERIC_FIELDS.has(field)) {
    const hasNumber = /\d/.test(lower) || NUMBER_WORD_RE.test(lower);
    if (!hasNumber) return "Please say a number.";
  }

  if (field === "token_symbol") {
    const symbol = cleaned.replace(/[^a-z0-9]/gi, "");
    if (symbol.length < 2) return "Please repeat the token symbol.";
  }

  if (field === "name" || field === "location") {
    if (alnum.length < 2) return "Please repeat again.";
  }

  if (!field && alnum.length < 2) return "Please repeat again.";
  return null;
}

/**
 * Workflow-first assistant: intent routing happens on the backend; voice/text
 * feeds the same `/workflows/turn` pipeline. UI is a single “bubble” capsule
 * + orb — not a collapsible analytics dock.
 *
 * Voice: prefers OpenAI Whisper via `/workflows/transcribe` when configured;
 * falls back to the browser Web Speech API.
 */
export function ConversationalWorkflowBubble({ role }: { role: DashboardRole }) {
  const router = useRouter();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const mediaMimeRef = useRef<string>("audio/webm");
  const audioContextRef = useRef<AudioContext | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const sendTurnRef = useRef(useWorkflowRuntimeStore.getState().sendTurn);

  const transcribingRef = useRef(false);
  const whisperEnabledRef = useRef<boolean | null>(null);
  const mediaRecordingSupportedRef = useRef(false);
  const legacySpeechSupportedRef = useRef(false);
  const startWhisperRecordingRef = useRef<() => Promise<void>>(async () => {});
  const toggleLegacySpeechRecognitionRef = useRef<() => void>(() => {});

  const cleanupVoiceCapture = useCallback(() => {
    if (vadFrameRef.current !== null) {
      cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    void ctx?.close().catch(() => {});
  }, []);

  const [whisperEnabled, setWhisperEnabled] = useState<boolean | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  useEffect(() => subscribeSpeakingState(setAiSpeaking), []);

  const {
    open,
    draft,
    processing,
    listening,
    transcriptPreview,
    messages,
    workflowState,
    error,
    setOpen,
    setDraft,
    setListening,
    setTranscriptPreview,
    clearWorkflow,
    sendTurn,
  } = useWorkflowRuntimeStore((s) => s);

  useEffect(() => {
    sendTurnRef.current = sendTurn;
  }, [sendTurn]);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ enabled: boolean }>("/api/agents/workflows/transcription-status")
      .then((r) => {
        if (!cancelled) setWhisperEnabled(Boolean(r.enabled));
      })
      .catch(() => {
        if (!cancelled) setWhisperEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const legacySpeechSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    const w = window as SpeechWindow;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  const mediaRecordingSupported = useMemo(() => {
    return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }, []);

  const voiceCaptureSupported =
    whisperEnabled === true
      ? mediaRecordingSupported
      : whisperEnabled === false
        ? legacySpeechSupported
        : legacySpeechSupported || mediaRecordingSupported;

  useEffect(() => {
    return () => {
      cleanupVoiceCapture();
      recognitionRef.current?.abort();
      recognitionRef.current = null;
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    };
  }, [cleanupVoiceCapture]);

  useEffect(() => {
    registerWorkflowVoiceContinuation(async () => {
      const st = useWorkflowRuntimeStore.getState();
      if (!st.continuousVoiceSession || st.processing || st.listening) return;
      if (transcribingRef.current) return;
      st.setOpen(true);
      const we = whisperEnabledRef.current;
      const mediaOk = mediaRecordingSupportedRef.current;
      const legacyOk = legacySpeechSupportedRef.current;
      try {
        if (we === true && mediaOk) {
          await startWhisperRecordingRef.current();
        } else if (we === true && !mediaOk && legacyOk) {
          toggleLegacySpeechRecognitionRef.current();
        } else if (legacyOk) {
          toggleLegacySpeechRecognitionRef.current();
        } else if (we === null && mediaOk) {
          await startWhisperRecordingRef.current();
        }
      } catch {
        useWorkflowRuntimeStore.getState().setListening(false);
      }
    });
    return () => registerWorkflowVoiceContinuation(null);
  }, []);

  async function run(text: string) {
    await sendTurn(text, (actions) => executeWorkflowActions(actions, router));
  }

  const requestRepeat = useCallback(async (reason?: string) => {
    const message = reason || "Please repeat again.";
    appendAssistantMessage(message);
    await speakWorkflowAssistant(message);
    void invokeWorkflowVoiceContinuation();
  }, []);

  async function startWhisperRecording() {
    cleanupVoiceCapture();
    cancelWorkflowSpeech();
    const mime = pickRecorderMime();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mediaMimeRef.current = recorder.mimeType || "audio/webm";
    mediaChunksRef.current = [];

    const AudioCtx =
      typeof window !== "undefined"
        ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AudioCtx) throw new Error("AudioContext not supported");
    const audioCtx = new AudioCtx();
    audioContextRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let heardSpeech = false;
    let silenceStart: number | null = null;
    const startedAt = performance.now();
    // Sensitivity calibration — sample the room for ~250ms so VAD doesn't
    // misclassify a noisy mic baseline as "speech" and never trigger silence.
    let noiseFloorSamples = 0;
    let noiseFloorAccum = 0;
    let noiseFloor = 0.01;
    let calibratedAt = 0;

    const stopRecorderFromVad = () => {
      if (vadFrameRef.current !== null) {
        cancelAnimationFrame(vadFrameRef.current);
        vadFrameRef.current = null;
      }
      mediaRecorderRef.current?.stop();
    };

    const vadTick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i += 1) {
        const v = (buf[i]! - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();

      // First ~300ms: learn baseline. Use 2.5× baseline as the loud threshold.
      if (now - startedAt < 300) {
        noiseFloorAccum += rms;
        noiseFloorSamples += 1;
        if (noiseFloorSamples > 0) noiseFloor = noiseFloorAccum / noiseFloorSamples;
        vadFrameRef.current = requestAnimationFrame(vadTick);
        return;
      }
      if (calibratedAt === 0) calibratedAt = now;

      const threshold = Math.max(0.012, noiseFloor * 2.5);
      const loud = rms > threshold;

      if (loud) {
        heardSpeech = true;
        silenceStart = null;
      } else if (heardSpeech) {
        // 900ms of silence after speech → user finished talking.
        if (silenceStart === null) silenceStart = now;
        else if (now - silenceStart > 900) {
          stopRecorderFromVad();
          return;
        }
      } else if (now - calibratedAt > 6000) {
        // 6s with no detected speech → user didn't say anything, stop and reset.
        stopRecorderFromVad();
        return;
      }

      // Hard cap: never record more than 15s in one turn.
      if (now - startedAt > 15000) {
        stopRecorderFromVad();
        return;
      }

      vadFrameRef.current = requestAnimationFrame(vadTick);
    };

    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) mediaChunksRef.current.push(ev.data);
    };
    recorder.onstop = () => {
      cleanupVoiceCapture();
      stream.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
      setListening(false);

      const blob = new Blob(mediaChunksRef.current, { type: mediaMimeRef.current });
      mediaChunksRef.current = [];
      void (async () => {
        if (blob.size < 320) {
          setTranscriptPreview("");
          await requestRepeat();
          return;
        }
        setTranscribing(true);
        setTranscriptPreview("Transcribing with Whisper…");
        try {
          const fd = new FormData();
          fd.append("file", blob, "speech.webm");
          const res = await api.postMultipart<{ text: string }>("/api/agents/workflows/transcribe", fd);
          const said = res.text.trim();
          setTranscriptPreview("");
          if (!said) {
            await requestRepeat();
            return;
          }
          const activeField = useWorkflowRuntimeStore.getState().workflowState?.active_field ?? null;
          const rejection = shouldRejectTranscript(said, activeField);
          if (rejection) {
            await requestRepeat(rejection);
            return;
          }
          await sendTurnRef.current(said, (actions) => executeWorkflowActions(actions, router), { fromVoice: true });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Transcription failed.";
          useWorkflowRuntimeStore.setState((state) => ({
            error: msg,
            messages: [
              ...state.messages,
              {
                id: `wf-msg-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())}`,
                role: "assistant",
                content: msg,
                createdAt: new Date().toISOString(),
              },
            ],
          }));
          setTranscriptPreview("");
        } finally {
          setTranscribing(false);
        }
      })();
    };

    mediaRecorderRef.current = recorder;
    recorder.start(250);
    vadFrameRef.current = requestAnimationFrame(vadTick);
    setOpen(true);
    setListening(true);
    setTranscriptPreview("Listening… pause when you're done");
  }

  function toggleLegacySpeechRecognition() {
    if (!legacySpeechSupported || typeof window === "undefined") return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const w = window as SpeechWindow;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    cancelWorkflowSpeech();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event: unknown) => {
      const ev = event as {
        resultIndex: number;
        results: Array<{ 0: { transcript: string }; isFinal: boolean }>;
      };
      const chunks: string[] = [];
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const result = ev.results[i];
        const text = String(result[0]?.transcript ?? "").trim();
        if (text) chunks.push(text);
      }
      const finalText = chunks.join(" ").trim();
      setTranscriptPreview("");
      if (!finalText) {
        void requestRepeat();
        return;
      }
      const activeField = useWorkflowRuntimeStore.getState().workflowState?.active_field ?? null;
      const rejection = shouldRejectTranscript(finalText, activeField);
      if (rejection) {
        void requestRepeat(rejection);
        return;
      }
      void sendTurnRef.current(finalText, (actions) => executeWorkflowActions(actions, router), { fromVoice: true });
    };
    recognition.onerror = () => {
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      setTranscriptPreview("");
    };
    recognitionRef.current = recognition;
    setOpen(true);
    setListening(true);
    recognition.start();
  }

  async function toggleListening() {
    if (processing || transcribing) return;

    if (whisperEnabled === true && mediaRecordingSupported) {
      if (listening) {
        cleanupVoiceCapture();
        mediaRecorderRef.current?.stop();
        return;
      }
      try {
        await startWhisperRecording();
      } catch {
        setListening(false);
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      }
      return;
    }

    if (whisperEnabled === true && !mediaRecordingSupported && legacySpeechSupported) {
      toggleLegacySpeechRecognition();
      return;
    }

    if (legacySpeechSupported) {
      toggleLegacySpeechRecognition();
      return;
    }

    if (whisperEnabled === null && mediaRecordingSupported) {
      try {
        await startWhisperRecording();
      } catch {
        setListening(false);
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      }
    }
  }

  function handleOrbClick() {
    unlockWorkflowAudio();
    if (processing || transcribing) {
      setOpen(true);
      return;
    }
    if (!open) {
      setOpen(true);
      if (voiceCaptureSupported) void toggleListening();
      return;
    }
    void toggleListening();
  }

  transcribingRef.current = transcribing;
  whisperEnabledRef.current = whisperEnabled;
  mediaRecordingSupportedRef.current = mediaRecordingSupported;
  legacySpeechSupportedRef.current = legacySpeechSupported;
  startWhisperRecordingRef.current = startWhisperRecording;
  toggleLegacySpeechRecognitionRef.current = toggleLegacySpeechRecognition;

  const lastMessages = messages.slice(-12);
  const modeLabel = workflowState.workflow_id ? workflowState.label || "Active workflow" : roleLabel(role);
  const activeWorkflow = Boolean(workflowState.workflow_id);

  const voiceFootnote =
    whisperEnabled === true
      ? "Voice → OpenAI Whisper (server)"
      : whisperEnabled === false
        ? "Voice → browser speech API"
        : "";

  const statePill: { label: string; tone: "idle" | "listen" | "think" | "speak" | "run" } =
    aiSpeaking
      ? { label: "Speaking", tone: "speak" }
      : listening
        ? { label: "Listening", tone: "listen" }
        : processing || transcribing
          ? { label: "Thinking", tone: "think" }
          : activeWorkflow
            ? { label: "Running", tone: "run" }
            : { label: "Idle", tone: "idle" };

  const stateChipClass = {
    idle: "bg-muted/40 text-muted-foreground",
    listen: "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30",
    think: "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30",
    speak: "bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/40 animate-pulse",
    run: "bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30",
  }[statePill.tone];

  return (
    <div
      data-workflow-bubble=""
      className="pointer-events-none fixed bottom-5 right-5 z-[100] flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-0"
    >
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onPointerDown={unlockWorkflowAudio}
            className="pointer-events-auto mb-3 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-card/95 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.45)] ring-1 ring-primary/15 backdrop-blur-xl dark:bg-card/90"
          >
            {/* Bubble header */}
            <div className="relative flex items-start gap-3 border-b border-border/60 px-4 pb-3 pt-4">
              <div
                className={cn(
                  "relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl shadow-inner transition-colors",
                  aiSpeaking
                    ? "bg-gradient-to-br from-violet-500/40 to-fuchsia-500/10 text-violet-100"
                    : listening
                      ? "bg-gradient-to-br from-emerald-500/35 to-emerald-500/5 text-emerald-300"
                      : "bg-gradient-to-br from-primary/25 to-primary/5 text-primary",
                )}
              >
                {aiSpeaking ? (
                  <span className="pointer-events-none absolute inset-0 animate-ping rounded-2xl bg-violet-400/30" aria-hidden />
                ) : null}
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold tracking-tight">EstateChain AI</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide",
                      stateChipClass,
                    )}
                  >
                    {statePill.label}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">{modeLabel}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Conversation stream */}
            <div className="max-h-[min(52vh,28rem)] space-y-2.5 overflow-y-auto px-4 py-3 scrollbar-thin">
              {lastMessages.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={cn(
                    "max-w-[94%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm",
                    item.role === "user"
                      ? "ml-auto bg-gradient-to-br from-primary to-primary/85 text-primary-foreground"
                      : item.role === "system"
                        ? "mx-auto border border-dashed border-border/80 bg-muted/30 text-center text-[11px] text-muted-foreground"
                        : "mr-auto border border-border/50 bg-muted/40 text-foreground",
                  )}
                >
                  {item.content}
                </motion.div>
              ))}
              {transcriptPreview ? (
                <div className="ml-auto max-w-[94%] rounded-2xl border border-primary/35 bg-primary/10 px-3.5 py-2 text-[13px] italic text-primary">
                  {transcriptPreview}
                </div>
              ) : null}
              {aiSpeaking ? (
                <div className="mr-auto flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-[11px] text-violet-300">
                  <span className="flex gap-0.5">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-violet-400 [animation-delay:0ms]" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-violet-400 [animation-delay:150ms]" />
                    <span className="h-1 w-1 animate-pulse rounded-full bg-violet-400 [animation-delay:300ms]" />
                  </span>
                  Speaking…
                </div>
              ) : null}
            </div>

            {/* Composer capsule */}
            <div className="border-t border-border/60 bg-muted/15 px-3 pb-4 pt-3">
              <form
                className="flex items-center gap-2 rounded-full border border-border/70 bg-background/90 p-1 pl-2 shadow-inner"
                onSubmit={(event) => {
                  event.preventDefault();
                  unlockWorkflowAudio();
                  void run(draft);
                }}
              >
                <Button
                  type="button"
                  variant={listening ? "default" : "ghost"}
                  size="icon"
                  className={cn("h-10 w-10 shrink-0 rounded-full", listening && "bg-success text-success-foreground")}
                  onClick={(e) => {
                    e.preventDefault();
                    unlockWorkflowAudio();
                    void toggleListening();
                  }}
                  disabled={!voiceCaptureSupported || processing || transcribing}
                  title={
                    !voiceCaptureSupported
                      ? "Voice not supported in this browser"
                      : whisperEnabled === true
                        ? "Record — sends audio to OpenAI Whisper"
                        : "Voice — browser speech API or Whisper when configured"
                  }
                >
                  {transcribing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : listening ? (
                    <MicOff className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </Button>
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={
                    listening
                      ? "Listening… I'll stop on silence"
                      : aiSpeaking
                        ? "Speaking…"
                        : 'Try: "Create a new property"'
                  }
                  className="h-10 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                  disabled={processing}
                />
                <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={processing || !draft.trim()}>
                  {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
              <div className="mt-2 flex items-center justify-between gap-2 px-1">
                <span className="truncate text-[10px] text-muted-foreground">
                  {error ||
                    (transcribing
                      ? "Transcribing…"
                      : listening && whisperEnabled === true
                        ? "Recording…"
                        : listening
                          ? "Listening…"
                          : workflowState.active_field
                            ? `Need: ${workflowState.active_field}`
                            : voiceFootnote
                              ? `${voiceFootnote} · Executable intents run first`
                              : "Executable intents run first")}
                </span>
                <Button type="button" variant="ghost" size="xs" className="h-6 shrink-0 px-2 text-[10px]" onClick={clearWorkflow}>
                  Reset
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Floating orb — global mic / open bubble */}
      <motion.button
        type="button"
        layout
        whileTap={{ scale: 0.94 }}
        className={cn(
          "pointer-events-auto relative grid h-[3.75rem] w-[3.75rem] place-items-center rounded-full shadow-[0_12px_40px_-8px_rgba(0,0,0,0.55)] ring-4 ring-background/80 transition-colors",
          aiSpeaking
            ? "bg-violet-500 text-white"
            : listening
              ? "bg-success text-success-foreground"
              : "bg-primary text-primary-foreground",
          processing && "opacity-90",
        )}
        onClick={handleOrbClick}
        aria-label={open ? (listening ? "Stop voice" : "Toggle voice") : "Open workflow assistant"}
      >
        {aiSpeaking ? (
          <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-violet-400/50" aria-hidden />
        ) : null}
        {processing || transcribing ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : listening ? (
          <MicOff className="h-6 w-6" />
        ) : (
          <Bot className="h-6 w-6" />
        )}
      </motion.button>
    </div>
  );
}

function roleLabel(role: DashboardRole) {
  if (role === "property_owner") return "Property owner · workflows";
  if (role === "investor") return "Investor · workflows";
  return "Tenant · workflows";
}
