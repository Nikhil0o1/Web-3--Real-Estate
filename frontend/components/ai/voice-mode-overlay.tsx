"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mic, MicOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/lib/ai/agent-store";

const STATE_LABELS: Record<string, string> = {
  idle: "Tap to start",
  listening: "Listening…",
  recording: "Listening…",
  transcribing: "Got it…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  error: "Connection issue",
};

const STATE_HINTS: Record<string, string> = {
  listening: "Just speak — I'll respond.",
  recording: "I'm hearing you…",
  transcribing: "Processing what you said…",
  thinking: "Working on a reply…",
  speaking: "Tap to interrupt or just talk over me.",
  error: "Tap the mic to retry.",
};

export function VoiceModeOverlay() {
  const store = useAgentStore();
  const { voiceMode, state, micLevel, error, messages, aiSpeaking } = store;

  // Capture the most recent user line + most recent assistant line for context.
  const recent = useMemo(() => {
    let lastUser = "";
    let lastAssistant = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!lastAssistant && m.role === "assistant") lastAssistant = m.content;
      if (!lastUser && m.role === "user") lastUser = m.content;
      if (lastUser && lastAssistant) break;
    }
    return { lastUser, lastAssistant };
  }, [messages]);

  // For a smoother orb motion: average mic level with a small smoothing factor.
  const [smoothLevel, setSmoothLevel] = useState(0);
  useEffect(() => {
    setSmoothLevel((prev) => prev * 0.6 + micLevel * 0.4);
  }, [micLevel]);

  if (!voiceMode) return null;

  const isSpeaking = state === "speaking" || aiSpeaking;
  const isThinking = state === "thinking" || state === "transcribing";
  const isListening = state === "listening" || state === "recording";

  // Orb scale follows mic level when listening; gentle breathing pulse when AI speaks.
  const orbScale = isListening ? 1 + smoothLevel * 0.55 : 1;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[200] flex flex-col items-center justify-between overflow-hidden"
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-background/85 backdrop-blur-2xl" />
        <div className="absolute inset-0 -z-0 ambient-edge opacity-80" />

        {/* Top bar */}
        <div className="relative z-10 flex w-full items-center justify-between px-6 pt-6">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span className="text-xs font-medium tracking-wide text-muted-foreground">
              EstateChain Voice
            </span>
          </div>
          <button
            onClick={() => store.exitVoiceMode()}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground/5 text-foreground/70 transition hover:bg-foreground/10 hover:text-foreground"
            aria-label="Close voice mode"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Centered orb + status */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-10 px-6">
          <ReactiveOrb
            isListening={isListening}
            isThinking={isThinking}
            isSpeaking={isSpeaking}
            level={smoothLevel}
            scale={orbScale}
          />

          <div className="flex max-w-md flex-col items-center gap-2 text-center">
            <motion.span
              key={state}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-base font-medium text-foreground/85"
            >
              {STATE_LABELS[state] || "…"}
            </motion.span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              {error ? error : STATE_HINTS[state] || ""}
            </span>
          </div>

          {/* Live captions */}
          <div className="flex w-full max-w-lg flex-col gap-3 px-2">
            {recent.lastUser && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="self-end max-w-[90%] rounded-2xl rounded-br-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg"
              >
                {recent.lastUser}
              </motion.div>
            )}
            {recent.lastAssistant && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="self-start max-w-[90%] rounded-2xl rounded-bl-md border border-border/60 bg-card/80 px-4 py-2 text-sm text-foreground shadow-lg backdrop-blur"
              >
                {recent.lastAssistant}
              </motion.div>
            )}
          </div>
        </div>

        {/* Bottom controls */}
        <div className="relative z-10 mb-8 flex items-center gap-4 px-6 pb-2">
          <button
            onClick={() => store.exitVoiceMode()}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground/10 text-foreground/80 transition hover:bg-foreground/15 hover:text-foreground"
            aria-label="End voice session"
          >
            <MicOff className="h-5 w-5" />
          </button>
          <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            End session
          </span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function ReactiveOrb({
  isListening,
  isThinking,
  isSpeaking,
  level,
  scale,
}: {
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  level: number;
  scale: number;
}) {
  // Hue shifts subtly with state — gold base, plum for speaking, amber for thinking.
  const ringColor = isSpeaking
    ? "from-[hsl(var(--chart-3)/0.8)] via-[hsl(var(--primary)/0.6)] to-[hsl(var(--primary)/0.8)]"
    : isThinking
    ? "from-[hsl(var(--warning)/0.8)] via-[hsl(var(--primary)/0.6)] to-[hsl(var(--primary)/0.8)]"
    : "from-[hsl(var(--primary)/0.8)] via-[hsl(var(--primary)/0.7)] to-[hsl(var(--primary)/0.85)]";

  return (
    <div className="relative flex h-[260px] w-[260px] items-center justify-center">
      {/* Outer halo */}
      <motion.div
        className={cn(
          "absolute inset-0 rounded-full bg-gradient-to-br opacity-50 blur-3xl",
          ringColor,
        )}
        animate={{
          scale: isSpeaking ? [1, 1.05, 1] : isThinking ? [1, 1.02, 1] : 1 + level * 0.25,
          opacity: isSpeaking ? [0.45, 0.7, 0.45] : isListening ? 0.55 + level * 0.3 : 0.5,
        }}
        transition={{
          duration: isSpeaking ? 2.2 : 3,
          repeat: isSpeaking || isThinking ? Infinity : 0,
          ease: "easeInOut",
        }}
      />

      {/* Pulsing rings (only when listening) */}
      {isListening && level > 0.05 && (
        <>
          <motion.div
            className="absolute inset-6 rounded-full border border-primary/40"
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 1.4, opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.div
            className="absolute inset-10 rounded-full border border-primary/40"
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut", delay: 0.3 }}
          />
        </>
      )}

      {/* Core orb */}
      <motion.div
        animate={{ scale }}
        transition={{ type: "spring", stiffness: 180, damping: 18 }}
        className="relative h-44 w-44 rounded-full"
      >
        <div className={cn(
          "absolute inset-0 rounded-full bg-gradient-to-br shadow-[0_0_80px_-10px_hsl(var(--primary)/0.6)]",
          isSpeaking
            ? "from-[hsl(var(--chart-3))] via-[hsl(var(--primary-soft))] to-[hsl(243_70%_38%)]"
            : isThinking
            ? "from-[hsl(var(--warning))] via-[hsl(var(--primary-soft))] to-[hsl(243_70%_38%)]"
            : "from-[hsl(var(--primary-soft))] via-primary to-[hsl(243_70%_38%)]",
        )} />
        {/* Highlight */}
        <div className="absolute inset-3 rounded-full bg-gradient-to-br from-white/40 via-white/5 to-transparent" />
        {/* Inner specular */}
        <div className="absolute left-8 top-6 h-10 w-10 rounded-full bg-white/40 blur-xl" />
        {/* Mic icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Mic
            className={cn(
              "h-9 w-9 transition-colors",
              isSpeaking ? "text-white/90" : "text-white/85",
            )}
          />
        </div>
      </motion.div>
    </div>
  );
}
