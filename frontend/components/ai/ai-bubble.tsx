"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Loader2,
  MessageSquareText,
  Mic,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/lib/ai/agent-store";
import { unlockAudio } from "@/lib/ai/voice";

type StateMeta = { label: string; className: string };

function getStateLabel(state: string): StateMeta {
  if (state === "thinking") return { label: "Thinking…", className: "bg-blue-500/10 text-blue-500" };
  if (state === "listening") return { label: "Listening…", className: "bg-rose-500/10 text-rose-500" };
  if (state === "speaking") return { label: "Speaking…", className: "bg-violet-500/10 text-violet-500" };
  if (state === "error") return { label: "Error", className: "bg-red-500/10 text-red-500" };
  return { label: "Online", className: "bg-emerald-500/10 text-emerald-500" };
}

export function AIBubble() {
  const router = useRouter();
  const draftRef = useRef<HTMLInputElement>(null);
  const store = useAgentStore();
  const { open, messages, state, error, aiSpeaking } = store;

  useEffect(() => {
    if (open) unlockAudio();
  }, [open]);

  async function handleUserText(text: string) {
    await store.send(text, router, { fromVoice: false });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draftRef.current?.value ?? "";
    if (!text.trim() || state === "thinking") return;
    if (draftRef.current) draftRef.current.value = "";
    void handleUserText(text);
  }

  function handleOrbClick() {
    store.setOpen(!open);
  }

  async function handleMicClick() {
    unlockAudio();
    await store.toggleVoice(router);
  }

  const lastMessages = messages.slice(-20);
  const stateLabel = getStateLabel(state);
  const listening = state === "listening";
  const busy = state === "thinking";
  const micDisabled = busy;

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
                  "bg-gradient-to-br from-primary/25 to-primary/5 text-primary",
                )}
              >
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold tracking-tight">EstateChain AI</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide",
                      stateLabel.className,
                    )}
                  >
                    {stateLabel.label}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">
                  Ask me anything — type or tap the mic.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20"
                onClick={() => store.setOpen(false)}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>

            {/* Transcript */}
            <div className="relative flex max-h-[300px] min-h-[140px] flex-col overflow-y-auto px-1 py-2">
              <div className="flex flex-1 flex-col justify-end gap-3 px-3 py-2">
                {lastMessages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center space-y-3 opacity-60">
                    <Bot className="h-8 w-8 text-primary/40" />
                    <p className="text-center text-xs text-muted-foreground">
                      I can help you navigate properties, investments, and your dashboard.
                    </p>
                  </div>
                ) : (
                  lastMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex w-max max-w-[85%] flex-col rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm",
                        msg.role === "user"
                          ? "self-end rounded-br-sm bg-primary text-primary-foreground"
                          : "self-start rounded-bl-sm border border-border/50 bg-secondary/50 text-secondary-foreground",
                      )}
                    >
                      {msg.content}
                    </div>
                  ))
                )}

                <AnimatePresence>
                  {busy && (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 2 }}
                      className="flex self-start rounded-2xl rounded-bl-sm border border-border/50 bg-secondary/50 px-4 py-3"
                    >
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </motion.div>
                  )}
                </AnimatePresence>

                {error && (
                  <div className="mt-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-[11px] leading-tight text-destructive">
                    <span className="font-semibold">Error:</span> {error}
                  </div>
                )}
              </div>
            </div>

            {/* Input row */}
            <div className="bg-background/40 p-3 pt-2">
              <form
                name="ai-text-input"
                onSubmit={handleSubmit}
                className="relative flex items-center gap-2"
              >
                <div className="relative flex flex-1 items-center overflow-hidden rounded-xl border border-input bg-background/60 shadow-sm transition-colors focus-within:border-primary/50 focus-within:bg-background">
                  <Input
                    ref={draftRef}
                    placeholder={listening ? "Listening…" : "Type a message…"}
                    className="h-11 border-0 bg-transparent px-3.5 py-0 text-[13px] shadow-none focus-visible:ring-0"
                    disabled={busy || listening}
                    autoFocus
                  />
                  <Button
                    type="submit"
                    size="icon"
                    disabled={busy || listening}
                    className="mr-1 h-8 w-8 shrink-0 rounded-lg hover:bg-primary"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant={listening ? "default" : "outline"}
                  disabled={micDisabled}
                  onClick={handleMicClick}
                  className={cn(
                    "relative h-11 w-11 shrink-0 rounded-xl transition-all",
                    listening &&
                      "bg-rose-500 text-white hover:bg-rose-600 ring-2 ring-rose-300/60 ring-offset-2 ring-offset-background",
                    aiSpeaking && !listening && "border-violet-400 text-violet-600",
                  )}
                  title={
                    listening
                      ? "Cancel listening"
                      : aiSpeaking
                      ? "Stop playback"
                      : "Tap to speak"
                  }
                >
                  {listening ? (
                    <Square className="h-4 w-4" fill="currentColor" />
                  ) : aiSpeaking ? (
                    <Square className="h-4 w-4" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                  {listening && (
                    <span className="pointer-events-none absolute inset-0 -z-10 animate-ping rounded-xl bg-rose-500/40" />
                  )}
                </Button>
              </form>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={handleOrbClick}
        className={cn(
          "pointer-events-auto group relative flex h-14 w-14 items-center justify-center rounded-[1.25rem] shadow-xl transition-all duration-300",
          open
            ? "bg-muted/80 ring-1 ring-border"
            : "bg-primary text-primary-foreground shadow-primary/25 hover:shadow-primary/40 ring-1 ring-primary/20",
        )}
      >
        {open ? (
          <X className="h-6 w-6 text-foreground/70 transition-transform group-hover:rotate-90" />
        ) : (
          <MessageSquareText className="h-6 w-6 transition-transform" />
        )}
      </motion.button>
    </div>
  );
}
