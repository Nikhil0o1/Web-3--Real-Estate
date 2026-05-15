"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bot, Loader2, Mic, MicOff, Send, X } from "lucide-react";
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
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
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
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
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

  const lastMessages = messages.slice(-5);
  const currentLabel = workflowState.label || roleLabel(role);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-3">
      <AnimatePresence>
        {open ? (
          <motion.section
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">Workflow Bubble</div>
                  <div className="truncate text-[11px] text-muted-foreground">{currentLabel}</div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {workflowState.status && workflowState.status !== "idle" ? (
                  <Badge variant={workflowState.status === "ready" ? "success" : "outline"} className="rounded-full text-[10px]">
                    {workflowState.status}
                  </Badge>
                ) : null}
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto px-3 py-3 scrollbar-thin">
              {lastMessages.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "max-w-[92%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                    item.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : item.role === "system"
                        ? "mx-auto border border-border bg-muted/40 text-xs text-muted-foreground"
                        : "bg-muted/55 text-foreground",
                  )}
                >
                  {item.content}
                </div>
              ))}
              {transcriptPreview ? (
                <div className="ml-auto max-w-[92%] rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
                  {transcriptPreview}
                </div>
              ) : null}
            </div>

            <div className="border-t border-border/70 p-3">
              <form
                className="flex min-w-0 items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(draft);
                }}
              >
                <Button
                  type="button"
                  variant={listening ? "default" : "outline"}
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-full"
                  onClick={toggleListening}
                  disabled={!speechSupported || processing}
                  title={speechSupported ? "Voice" : "Voice is not supported in this browser"}
                >
                  {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={listening ? "Listening..." : "Type a workflow request"}
                  className="h-10 min-w-0 rounded-full bg-background"
                  disabled={processing}
                />
                <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-full" disabled={processing || !draft.trim()}>
                  {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-[11px] text-muted-foreground">
                  {error || (listening ? "Listening" : workflowState.active_field ? `Waiting for ${workflowState.active_field}` : "Ready")}
                </span>
                <Button type="button" variant="ghost" size="xs" className="h-6 px-2 text-[11px]" onClick={clearWorkflow}>
                  Clear
                </Button>
              </div>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      <Button
        type="button"
        size="icon"
        className={cn(
          "h-14 w-14 rounded-full shadow-2xl transition-transform hover:scale-105",
          listening && "bg-success text-success-foreground",
        )}
        onClick={() => setOpen(!open)}
        aria-label="Open workflow bubble"
      >
        {processing ? <Loader2 className="h-5 w-5 animate-spin" /> : listening ? <Mic className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
      </Button>
    </div>
  );
}

function roleLabel(role: DashboardRole) {
  if (role === "property_owner") return "Property owner workflows";
  if (role === "investor") return "Investor workflows";
  return "Tenant workflows";
}
