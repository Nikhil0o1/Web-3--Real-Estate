"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  AudioLines,
  Bot,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/lib/ai/agent-store";
import { unlockAudio } from "@/lib/ai/voice";
import { VoiceModeOverlay } from "./voice-mode-overlay";

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-primary/70"
          animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function getStatePill(state: string) {
  if (state === "thinking" || state === "transcribing")
    return { label: "Thinking", className: "bg-amber-500/15 text-amber-600 dark:text-amber-300" };
  if (state === "listening" || state === "recording")
    return { label: "Listening", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" };
  if (state === "speaking")
    return { label: "Speaking", className: "bg-violet-500/15 text-violet-600 dark:text-violet-300" };
  if (state === "error")
    return { label: "Offline", className: "bg-rose-500/15 text-rose-600 dark:text-rose-300" };
  return { label: "Online", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" };
}

export function AIBubble() {
  const router = useRouter();
  const draftRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const store = useAgentStore();
  const { open, messages, state, error, voiceMode } = store;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, state]);

  useEffect(() => {
    if (open) unlockAudio();
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draftRef.current?.value ?? "";
    if (!text.trim() || state === "thinking") return;
    if (draftRef.current) draftRef.current.value = "";
    void store.send(text, router, { fromVoice: false });
  }

  async function handleVoiceClick() {
    unlockAudio();
    await store.enterVoiceMode(router);
  }

  const lastMessages = messages.slice(-30);
  const pill = getStatePill(state);
  const busy = state === "thinking";

  return (
    <>
      <VoiceModeOverlay />

      <div
        data-workflow-bubble=""
        className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-auto flex-col items-end gap-0"
      >
        <AnimatePresence>
          {open && !voiceMode && (
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto mb-3 flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-border/60 bg-card/95 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.45)] ring-1 ring-primary/10 backdrop-blur-xl"
            >
              {/* Header */}
              <div className="relative flex items-start gap-3 border-b border-border/60 bg-gradient-to-br from-primary/8 via-transparent to-transparent px-4 pb-3 pt-4">
                <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-md shadow-primary/25">
                  <Sparkles className="h-5 w-5" />
                  <motion.span
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-card"
                    animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                </div>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold tracking-tight">
                      EstateChain Copilot
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide",
                        pill.className,
                      )}
                    >
                      {pill.label}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">
                    Ask anything · type or tap voice for a live conversation.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => store.setOpen(false)}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Transcript */}
              <div
                ref={scrollRef}
                className="scrollbar-thin relative flex max-h-[380px] min-h-[180px] flex-col overflow-y-auto px-1 py-2 scroll-smooth"
              >
                <div className="flex flex-1 flex-col justify-end gap-2.5 px-3 py-2">
                  {lastMessages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 py-10 opacity-70">
                      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                        <Bot className="h-6 w-6" />
                      </div>
                      <p className="max-w-[80%] text-center text-xs leading-relaxed text-muted-foreground">
                        I can help with properties, investments, rent, and your dashboard.
                        Try <em>"create a property"</em> or tap the voice icon.
                      </p>
                    </div>
                  ) : (
                    lastMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={cn(
                          "flex w-max max-w-[88%] flex-col rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm",
                          msg.role === "user"
                            ? "self-end rounded-br-md bg-primary text-primary-foreground"
                            : "self-start rounded-bl-md border border-border/60 bg-background/80 text-foreground",
                        )}
                      >
                        {msg.content || (msg.role === "assistant" && busy ? <ThinkingDots /> : null)}
                      </div>
                    ))
                  )}

                  <AnimatePresence>
                    {busy && lastMessages.length > 0 && lastMessages[lastMessages.length - 1]?.role !== "assistant" && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex self-start rounded-2xl rounded-bl-md border border-border/60 bg-background/80 px-3 py-2"
                      >
                        <ThinkingDots />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {error && (
                    <div className="mt-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] leading-tight text-destructive">
                      <span className="font-semibold">Error:</span> {error}
                    </div>
                  )}
                </div>
              </div>

              {/* Input row */}
              <div className="border-t border-border/60 bg-background/50 p-3">
                <form name="ai-text-input" onSubmit={handleSubmit} className="relative flex items-center gap-2">
                  <div className="relative flex flex-1 items-center overflow-hidden rounded-xl border border-input bg-background shadow-sm transition-colors focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/15">
                    <Input
                      ref={draftRef}
                      placeholder="Message EstateChain…"
                      className="h-11 border-0 bg-transparent px-3.5 text-[13px] shadow-none focus-visible:ring-0"
                      disabled={busy}
                      autoFocus
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={busy}
                      className="mr-1 h-8 w-8 shrink-0 rounded-lg bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={handleVoiceClick}
                    className="relative h-11 w-11 shrink-0 rounded-xl border-primary/30 bg-gradient-to-br from-primary/10 to-transparent text-primary hover:border-primary/50 hover:bg-primary/15"
                    title="Start voice conversation"
                  >
                    <AudioLines className="h-4 w-4" />
                  </Button>
                </form>
                <p className="mt-2 px-1 text-[10px] leading-tight text-muted-foreground/80">
                  Voice runs continuously, like ChatGPT. Tap the wave icon to start.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Orb / launcher */}
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={() => store.setOpen(!open)}
          aria-label={open ? "Minimize EstateChain" : "Open EstateChain"}
          className={cn(
            "pointer-events-auto group relative flex h-16 w-16 items-center justify-center rounded-full transition-shadow duration-300",
            "shadow-[0_18px_45px_-15px_rgba(16,185,129,0.55)] hover:shadow-[0_24px_60px_-15px_rgba(16,185,129,0.7)]",
          )}
        >
          {/* Aurora gradient ring */}
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-300 via-emerald-500 to-emerald-700 opacity-95" />
          {/* Subtle halo */}
          <span className="absolute -inset-2 rounded-full bg-emerald-400/20 blur-xl transition-opacity group-hover:opacity-100" />
          {/* Inner glass */}
          <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-white/40 via-white/5 to-transparent backdrop-blur-sm" />
          {/* Top specular */}
          <span className="absolute left-3 top-2 h-4 w-4 rounded-full bg-white/60 blur-md" />
          {/* Icon */}
          <span className="relative flex h-full w-full items-center justify-center text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)]">
            {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
          </span>
          {/* Status ping */}
          {!open && (
            <motion.span
              className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-300 ring-2 ring-background"
              animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 2.2, repeat: Infinity }}
            />
          )}
        </motion.button>
      </div>
    </>
  );
}
