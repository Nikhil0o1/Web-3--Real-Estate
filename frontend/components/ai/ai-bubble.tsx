"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Mic, MicOff, Send, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAgentStore, setRearmMicRef } from "@/lib/ai/agent-store";
import { getRecordedBlob, onSpeakingChange, startRecording, unlockAudio } from "@/lib/ai/voice-runtime";
import { aiTranscribe } from "@/lib/ai/api";
import type { AIState } from "@/lib/ai/types";

export function AIBubble() {
  const router = useRouter();
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const draftRef = useRef<HTMLInputElement>(null);
  const stopRecordingRef = useRef<(() => void) | null>(null);
  const startMicRef = useRef<(() => void) | null>(null);
  const rearmGuardRef = useRef(false);

  const store = useAgentStore();
  const { open, messages, state, transcriptPreview, error, continuousVoice } = store;

  useEffect(() => onSpeakingChange(setAiSpeaking), []);

  /** Start microphone recording — reads current state via refs to avoid stale closures. */
  function startMic() {
    const s = useAgentStore.getState();
    if (s.aiSpeaking || s.state === "thinking" || stopRecordingRef.current) return;
    if (rearmGuardRef.current) return;

    // Stop any existing recording first (paranoid).
    const stopFn = stopRecordingRef.current as (() => void) | null;
    if (stopFn) {
      stopFn();
      stopRecordingRef.current = null;
    }

    unlockAudio();
    setListening(true);
    setTranscribing(false);
    s.setTranscriptPreview("Listening...");
    s.setContinuousVoice(true);

    const stop = startRecording({
      silenceMs: 1800,
      noSpeechMs: 12000,
      maxDurationMs: 30000,
      onEnd: () => {
        setListening(false);
        const blob = getRecordedBlob();
        if (!blob || blob.size < 800) {
          s.setTranscriptPreview("");
          return;
        }
        void processTranscription(blob);
      },
      onError: (err) => {
        setListening(false);
        s.setTranscriptPreview("");
        console.error("Recording error:", err);
      },
    });

    stopRecordingRef.current = stop;
  }

  // Keep the ref always pointing to the latest startMic.
  startMicRef.current = startMic;

  /** Stop microphone recording. */
  function stopMic() {
    const stopFn = stopRecordingRef.current as (() => void) | null;
    if (stopFn) {
      stopFn();
      stopRecordingRef.current = null;
    }
    setListening(false);
  }

  /** Toggle mic on/off. */
  function toggleMic() {
    if (listening || stopRecordingRef.current) {
      stopMic();
    } else {
      startMic();
    }
  }

  // Register rearm callback once on mount. It always delegates to startMicRef.current.
  useEffect(() => {
    setRearmMicRef(() => {
      const s = useAgentStore.getState();
      if (!s.continuousVoice || s.aiSpeaking || s.state === "thinking") return;
      if (rearmGuardRef.current) return;
      rearmGuardRef.current = true;
      window.setTimeout(() => {
        rearmGuardRef.current = false;
      }, 800);
      startMicRef.current?.();
    });
    return () => setRearmMicRef(null);
  }, []);

  // When opening bubble in voice mode, start listening after a brief delay.
  useEffect(() => {
    if (open && continuousVoice && !listening && !aiSpeaking && state === "idle") {
      const timer = setTimeout(() => startMic(), 600);
      return () => clearTimeout(timer);
    }
  }, [open]);

  /** Send blob to backend STT, then send text to AI. */
  async function processTranscription(blob: Blob) {
    setTranscribing(true);
    store.setTranscriptPreview("Transcribing...");
    try {
      const result = await aiTranscribe(blob);
      const text = result.text.trim();
      store.setTranscriptPreview("");
      if (!text) return; // silence — just idle
      await store.send(text, router, { fromVoice: true });
    } catch (err: any) {
      store.setTranscriptPreview("");
      console.error("Transcription failed:", err);
    } finally {
      setTranscribing(false);
    }
  }

  /** Handle text submit (typed or transcribed). */
  async function handleUserText(text: string) {
    await store.send(text, router, { fromVoice: false });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draftRef.current?.value ?? "";
    if (!text.trim() || state === "thinking") return;
    if (draftRef.current) draftRef.current.value = "";
    store.setContinuousVoice(false);
    void handleUserText(text);
  }

  function handleOrbClick() {
    unlockAudio();
    if (!open) {
      store.setOpen(true);
      return;
    }
    toggleMic();
  }

  const lastMessages = messages.slice(-20);
  const stateLabel = getStateLabel(state, aiSpeaking, listening, transcribing);

  return (
    <div
      data-workflow-bubble=""
      className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-auto flex-col items-end gap-0"
    >
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto mb-3 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-card/95 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.45)] ring-1 ring-primary/15 backdrop-blur-xl dark:bg-card/90"
          >
            {/* Header */}
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
                {aiSpeaking && (
                  <span className="pointer-events-none absolute inset-0 animate-ping rounded-2xl bg-violet-400/30" aria-hidden />
                )}
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold tracking-tight">EstateChain AI</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide", stateLabel.className)}>
                    {stateLabel.label}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">
                  {continuousVoice ? "Voice session active" : "Ask me anything"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => store.setOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="max-h-[min(52vh,28rem)] space-y-2.5 overflow-y-auto px-4 py-3 scrollbar-thin">
              {lastMessages.map((item, i) => (
                <motion.div
                  key={`${i}-${item.content.slice(0, 20)}`}
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
                  Speaking...
                </div>
              ) : null}
            </div>

            {/* Composer */}
            <div className="border-t border-border/60 bg-muted/15 px-3 pb-4 pt-3">
              <form
                className="flex items-center gap-2 rounded-full border border-border/70 bg-background/90 p-1 pl-2 shadow-inner"
                onSubmit={handleSubmit}
              >
                <Button
                  type="button"
                  variant={listening ? "default" : "ghost"}
                  size="icon"
                  className={cn("h-10 w-10 shrink-0 rounded-full", listening && "bg-success text-success-foreground")}
                  onClick={(e) => {
                    e.preventDefault();
                    unlockAudio();
                    toggleMic();
                  }}
                  disabled={state === "thinking" || transcribing}
                  title={listening ? "Stop listening" : "Start voice input"}
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
                  ref={draftRef}
                  placeholder={
                    listening
                      ? "Listening... speak naturally"
                      : aiSpeaking
                        ? "Speaking..."
                        : "Ask me anything..."
                  }
                  className="h-10 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                  disabled={state === "thinking"}
                />
                <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={state === "thinking"}>
                  {state === "thinking" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
              <div className="mt-2 flex items-center justify-between gap-2 px-1">
                <span className="truncate text-[10px] text-muted-foreground">
                  {error || (listening ? "I'll wait for you to finish speaking" : continuousVoice ? "Voice session active — say anything" : "Type or press the mic")}
                </span>
                <Button type="button" variant="ghost" size="xs" className="h-6 shrink-0 px-2 text-[10px]" onClick={() => store.clear()}>
                  Reset
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Floating Orb */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.94 }}
        className={cn(
          "pointer-events-auto relative grid h-[3.75rem] w-[3.75rem] place-items-center rounded-full shadow-[0_12px_40px_-8px_rgba(0,0,0,0.55)] ring-4 ring-background/80 transition-colors duration-200",
          aiSpeaking
            ? "bg-violet-500 text-white"
            : listening
              ? "bg-success text-success-foreground"
              : "bg-primary text-primary-foreground",
          state === "thinking" && "opacity-90",
        )}
        onClick={handleOrbClick}
        aria-label={open ? (listening ? "Stop voice" : "Toggle voice") : "Open AI assistant"}
      >
        {aiSpeaking && <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-violet-400/50" aria-hidden />}
        {state === "thinking" || transcribing ? (
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

function getStateLabel(
  state: AIState,
  speaking: boolean,
  listening: boolean,
  transcribing: boolean,
): { label: string; className: string } {
  if (speaking) return { label: "Speaking", className: "bg-violet-500/15 text-violet-400 ring-1 ring-violet-500/40 animate-pulse" };
  if (listening) return { label: "Listening", className: "bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30" };
  if (transcribing) return { label: "Thinking", className: "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30" };
  if (state === "thinking") return { label: "Thinking", className: "bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30" };
  if (state === "error") return { label: "Error", className: "bg-destructive/15 text-destructive ring-1 ring-destructive/30" };
  return { label: "Idle", className: "bg-muted/40 text-muted-foreground" };
}
