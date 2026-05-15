"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Mic, MicOff, Send, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { executeWorkflowActions } from "@/lib/workflows/action-runtime";
import { useWorkflowRuntimeStore } from "@/lib/workflows/workflow-runtime-store";
import type { DashboardRole } from "@/lib/workflows/types";
import { cn } from "@/lib/utils";

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

/**
 * Workflow-first assistant: intent routing happens on the backend; voice/text
 * feeds the same `/workflows/turn` pipeline. UI is a single “bubble” capsule
 * + orb — not a collapsible analytics dock.
 */
export function ConversationalWorkflowBubble({ role }: { role: DashboardRole }) {
  const router = useRouter();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sendTurnRef = useRef(useWorkflowRuntimeStore.getState().sendTurn);

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

  const speechSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    const w = window as SpeechWindow;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  async function run(text: string) {
    await sendTurn(text, (actions) => executeWorkflowActions(actions, router));
  }

  function toggleListening() {
    if (!speechSupported || typeof window === "undefined") return;

    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const w = window as SpeechWindow;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: unknown) => {
      const ev = event as {
        resultIndex: number;
        results: Array<{ 0: { transcript: string }; isFinal: boolean }>;
      };
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const result = ev.results[i];
        const text = String(result[0]?.transcript ?? "").trim();
        if (!text) continue;
        if (result.isFinal) {
          void sendTurnRef.current(text, (actions) => executeWorkflowActions(actions, router));
        } else {
          interim = [interim, text].filter(Boolean).join(" ");
        }
      }
      setTranscriptPreview(interim);
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

  function handleOrbClick() {
    if (processing) {
      setOpen(true);
      return;
    }
    if (!open) {
      setOpen(true);
      if (speechSupported) {
        toggleListening();
      }
      return;
    }
    toggleListening();
  }

  const lastMessages = messages.slice(-12);
  const modeLabel = workflowState.workflow_id ? workflowState.label || "Active workflow" : roleLabel(role);
  const activeWorkflow = Boolean(workflowState.workflow_id);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-0">
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto mb-3 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-card/95 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.45)] ring-1 ring-primary/15 backdrop-blur-xl dark:bg-card/90"
          >
            {/* Bubble header */}
            <div className="relative flex items-start gap-3 border-b border-border/60 px-4 pb-3 pt-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-primary shadow-inner">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold tracking-tight">Workflow</span>
                  {activeWorkflow ? (
                    <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px] font-normal">
                      Running
                    </Badge>
                  ) : (
                    <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px] font-normal">
                      Idle
                    </Badge>
                  )}
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
            <div className="max-h-[min(52vh,28rem)] space-y-2 overflow-y-auto px-4 py-3 scrollbar-thin">
              {lastMessages.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "max-w-[94%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm",
                    item.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : item.role === "system"
                        ? "mx-auto border border-dashed border-border/80 bg-muted/30 text-center text-[11px] text-muted-foreground"
                        : "mr-auto border border-border/50 bg-muted/40 text-foreground",
                  )}
                >
                  {item.content}
                </div>
              ))}
              {transcriptPreview ? (
                <div className="ml-auto max-w-[94%] rounded-2xl border border-primary/35 bg-primary/8 px-3.5 py-2 text-[13px] italic text-primary">
                  {transcriptPreview}
                </div>
              ) : null}
            </div>

            {/* Composer capsule */}
            <div className="border-t border-border/60 bg-muted/15 px-3 pb-4 pt-3">
              <form
                className="flex items-center gap-2 rounded-full border border-border/70 bg-background/90 p-1 pl-2 shadow-inner"
                onSubmit={(event) => {
                  event.preventDefault();
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
                    toggleListening();
                  }}
                  disabled={!speechSupported || processing}
                  title={speechSupported ? "Voice — routes to workflow intents" : "Voice not supported"}
                >
                  {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={listening ? "Listening… speak your next answer" : 'Try: "Create a new property"'}
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
                    (listening
                      ? "Voice → workflow router (not analytics chat)"
                      : workflowState.active_field
                        ? `Need: ${workflowState.active_field}`
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
          "pointer-events-auto grid h-[3.75rem] w-[3.75rem] place-items-center rounded-full shadow-[0_12px_40px_-8px_rgba(0,0,0,0.55)] ring-4 ring-background/80 transition-colors",
          listening ? "bg-success text-success-foreground" : "bg-primary text-primary-foreground",
          processing && "opacity-90",
        )}
        onClick={handleOrbClick}
        aria-label={open ? (listening ? "Stop voice" : "Toggle voice") : "Open workflow assistant"}
      >
        {processing ? (
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
