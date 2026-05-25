"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  AudioLines,
  BarChart3,
  ChevronRight,
  Clock,
  CreditCard,
  Home,
  MessageSquare,
  Mic,
  PieChart,
  Plus,
  Receipt,
  RotateCcw,
  Send,
  Sparkles,
  Store,
  TrendingUp,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/lib/ai/agent-store";
import type { AIState } from "@/lib/ai/types";
import { unlockAudio } from "@/lib/ai/voice";
import {
  getQuickActions,
  getRoleFromPath,
  getRoleLabel,
  type QuickAction,
} from "@/lib/ai/quick-actions";

const ICON_MAP: Record<string, LucideIcon> = {
  Store,
  PieChart,
  TrendingUp,
  Receipt,
  Plus,
  BarChart3,
  Wallet,
  Users,
  CreditCard,
  Home,
  Clock,
};

/** Soft pastel tint per quick-action slot. */
const ACTION_TINTS: { bg: string; ring: string; icon: string }[] = [
  { bg: "bg-[hsl(var(--chart-2)/0.14)]", ring: "ring-[hsl(var(--chart-2)/0.3)]", icon: "text-[hsl(var(--chart-2))]" },
  { bg: "bg-primary/12", ring: "ring-primary/30", icon: "text-primary" },
  { bg: "bg-[hsl(var(--chart-3)/0.14)]", ring: "ring-[hsl(var(--chart-3)/0.3)]", icon: "text-[hsl(var(--chart-3))]" },
  { bg: "bg-warning/12", ring: "ring-warning/30", icon: "text-warning" },
];

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-1.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-foreground/50"
          animate={{ y: [0, -3, 0], opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function getStatePill(state: AIState) {
  if (state === "thinking" || state === "transcribing")
    return { label: "Thinking", dot: "bg-warning" };
  if (state === "listening" || state === "recording")
    return { label: "Listening", dot: "bg-primary" };
  if (state === "speaking")
    return { label: "Speaking", dot: "bg-[hsl(var(--chart-3))]" };
  if (state === "error")
    return { label: "Offline", dot: "bg-destructive" };
  return { label: "Online", dot: "bg-emerald-500" };
}

/** Big quick-action card used on the welcome screen. */
function QuickActionCard({
  action,
  tint,
  onClick,
  disabled,
}: {
  action: QuickAction;
  tint: (typeof ACTION_TINTS)[number];
  onClick: () => void;
  disabled?: boolean;
}) {
  const Icon = ICON_MAP[action.icon] ?? Sparkles;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.985 }}
      className={cn(
        "group flex w-full items-center gap-3.5 rounded-2xl border border-border/60 bg-background/70 p-3.5 text-left",
        "transition-all hover:border-primary/40 hover:bg-primary/[0.04] hover:shadow-sm",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1",
          tint.bg,
          tint.ring,
        )}
      >
        <Icon className={cn("h-[18px] w-[18px]", tint.icon)} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold tracking-tight text-foreground">
          {action.label}
        </span>
        <span className="mt-0.5 line-clamp-1 block text-[11.5px] text-muted-foreground">
          {action.prompt}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
    </motion.button>
  );
}

/** Compact suggestion chip — horizontal scroll strip above the composer. */
function QuickActionChip({
  action,
  onClick,
  disabled,
}: {
  action: QuickAction;
  onClick: () => void;
  disabled?: boolean;
}) {
  const Icon = ICON_MAP[action.icon] ?? Sparkles;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/80 px-3 py-1.5 text-[12px] font-medium text-foreground/85",
        "transition-all hover:border-primary/40 hover:bg-primary/[0.05] hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <Icon className="h-3.5 w-3.5 text-primary/80 transition-colors group-hover:text-primary" />
      <span className="whitespace-nowrap">{action.label}</span>
    </button>
  );
}

/**
 * Autosizing textarea composer. Single-line by default, grows up to a
 * 4-line ceiling. Enter sends; Shift+Enter inserts a newline.
 */
function ComposerTextarea({
  textareaRef,
  disabled,
  onSubmit,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  disabled?: boolean;
  onSubmit: () => void;
}) {
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, 132); // ~4 lines
    el.style.height = `${next}px`;
  }, [textareaRef]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (disabled) return;
      const text = textareaRef.current?.value ?? "";
      if (!text.trim()) return;
      onSubmit();
      // Parent clears value + height; schedule a resize next frame for safety.
      requestAnimationFrame(resize);
    }
  }

  return (
    <textarea
      ref={textareaRef}
      data-ai-chat-input=""
      rows={1}
      onInput={resize}
      onKeyDown={handleKeyDown}
      placeholder="Message EstateChain Copilot…"
      disabled={disabled}
      autoFocus
      className={cn(
        "block w-full resize-none border-0 bg-transparent px-4 py-3 text-[13.5px] leading-[1.5] text-foreground outline-none",
        "placeholder:text-muted-foreground/70",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "scrollbar-thin",
      )}
      style={{ maxHeight: 132 }}
    />
  );
}

export function AIBubble() {
  const router = useRouter();
  const pathname = usePathname();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const store = useAgentStore();
  const { open, messages, state, error, voiceMode, micLevel } = store;

  const role = useMemo(() => getRoleFromPath(pathname), [pathname]);
  const quickActions = useMemo(() => getQuickActions(role), [role]);
  const roleLabel = useMemo(() => getRoleLabel(role), [role]);

  const subtitle = useMemo(() => {
    if (role === "investor") return "Portfolio · Yield · Marketplace";
    if (role === "property_owner") return "Properties · Investors · Rent";
    if (role === "tenant") return "Rentals · Payments · Wallet";
    return "Assistant · Status · Help";
  }, [role]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, state]);

  useEffect(() => {
    if (open) unlockAudio();
  }, [open]);

  // ESC closes the panel (when open).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") store.setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, store]);

  function submitDraft() {
    const text = textareaRef.current?.value ?? "";
    if (!text.trim() || state === "thinking") return;
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
    void store.send(text, router, { fromVoice: false });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitDraft();
  }

  function handleQuickAction(action: QuickAction) {
    if (state === "thinking") return;
    void store.send(action.prompt, router, { fromVoice: false });
  }

  async function handleVoiceClick() {
    unlockAudio();
    if (voiceMode) {
      store.exitVoiceMode();
    } else {
      await store.enterVoiceMode(router, { role });
    }
  }

  const lastMessages = messages.slice(-40);
  const pill = getStatePill(state);
  const busy = state === "thinking";
  const isListening = state === "listening" || state === "recording";
  const isSpeaking = state === "speaking";
  const hasUserConversation = messages.some((m) => m.role === "user");
  const showWelcome = !hasUserConversation;

  return (
    <div
      data-workflow-bubble=""
      className="pointer-events-none fixed bottom-6 right-6 z-[100] flex items-end justify-end"
    >
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "pointer-events-auto flex flex-col overflow-hidden",
              // Wider, more generous shell — production chat-widget proportions.
              "w-[min(38rem,calc(100vw-2rem))]",
              // Cap height so the panel never escapes the viewport.
              "max-h-[min(78dvh,780px)]",
              "rounded-[24px] border border-border/50 bg-card/95 backdrop-blur-2xl",
              "shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45),0_4px_14px_-4px_rgba(0,0,0,0.1)]",
              "ring-1 ring-foreground/[0.03]",
            )}
            role="dialog"
            aria-label="EstateChain Copilot"
          >
            {/* ─── Header ───────────────────────────────────── */}
            <header className="relative flex items-center gap-3 border-b border-border/40 bg-gradient-to-b from-foreground/[0.025] to-transparent px-5 py-4">
              {/* Brand avatar — mini gradient orb */}
              <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full">
                <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[hsl(var(--primary-soft))] via-primary to-[hsl(243_70%_38%)]" />
                <span className="absolute inset-[1.5px] rounded-full bg-gradient-to-br from-white/30 via-transparent to-transparent" />
                <span className="absolute inset-[2.5px] rounded-full ring-1 ring-inset ring-white/15" />
                <MessageSquare className="relative h-[18px] w-[18px] text-white drop-shadow-sm" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-foreground">
                    EstateChain Copilot
                  </h2>
                  {/* Inline status pill */}
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/50 bg-background/70 px-2 py-0.5",
                      "text-[10.5px] font-medium tracking-tight text-muted-foreground",
                    )}
                    title={pill.label}
                  >
                    <motion.span
                      className={cn("h-1.5 w-1.5 rounded-full", pill.dot)}
                      animate={{ opacity: [0.55, 1, 0.55] }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                    />
                    {pill.label}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11.5px] leading-tight text-muted-foreground">
                  {roleLabel} · {subtitle}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => store.clear()}
                  title="Clear conversation"
                  className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => store.setOpen(false)}
                  title="Close (Esc)"
                  className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {/* ─── Transcript ───────────────────────────────── */}
            <div
              ref={scrollRef}
              className="scrollbar-thin relative flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth"
            >
              <div className="flex flex-1 flex-col gap-3.5 px-5 py-5">
                {showWelcome ? (
                  <>
                    {/* Hero greeting */}
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[hsl(var(--primary-soft))] to-[hsl(243_70%_40%)] text-white shadow-sm ring-1 ring-primary/20">
                        <Sparkles className="h-3 w-3" />
                      </div>
                      <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-border/50 bg-background/80 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-foreground">
                        Welcome back! What would you like to do today?
                      </div>
                    </div>

                    {quickActions.length > 0 && (
                      <div className="mt-1.5 flex flex-col gap-2">
                        {quickActions.map((action, idx) => (
                          <QuickActionCard
                            key={action.id}
                            action={action}
                            tint={ACTION_TINTS[idx % ACTION_TINTS.length]}
                            onClick={() => handleQuickAction(action)}
                            disabled={busy}
                          />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  lastMessages.map((msg, i) => {
                    if (!msg.content && msg.role === "assistant" && !busy) return null;
                    const isUser = msg.role === "user";
                    return (
                      <div
                        key={i}
                        className={cn(
                          "flex w-full gap-2.5",
                          isUser ? "justify-end" : "justify-start",
                        )}
                      >
                        {!isUser && (
                          <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[hsl(var(--primary-soft))] to-[hsl(243_70%_40%)] text-white shadow-sm ring-1 ring-primary/20">
                            <Sparkles className="h-3 w-3" />
                          </div>
                        )}
                        <div
                          className={cn(
                            "max-w-[82%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                            isUser
                              ? "rounded-br-md bg-primary text-primary-foreground shadow-sm"
                              : "rounded-bl-md border border-border/50 bg-background/80 text-foreground",
                          )}
                        >
                          {msg.content || (msg.role === "assistant" && busy ? <ThinkingDots /> : null)}
                        </div>
                      </div>
                    );
                  })
                )}

                <AnimatePresence>
                  {busy &&
                    !showWelcome &&
                    lastMessages.length > 0 &&
                    lastMessages[lastMessages.length - 1]?.role !== "assistant" && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="flex items-end gap-2.5"
                      >
                        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[hsl(var(--primary-soft))] to-[hsl(243_70%_40%)] text-white shadow-sm ring-1 ring-primary/20">
                          <Sparkles className="h-3 w-3" />
                        </div>
                        <div className="rounded-2xl rounded-bl-md border border-border/50 bg-background/80 px-3 py-2">
                          <ThinkingDots />
                        </div>
                      </motion.div>
                    )}
                </AnimatePresence>

                {error && (
                  <div className="mt-1 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11.5px] leading-tight text-destructive">
                    <span className="font-semibold">Error:</span> {error}
                  </div>
                )}
              </div>
            </div>

            {/* ─── Quick-action chips (mid-conversation only) ─── */}
            {!voiceMode && !showWelcome && quickActions.length > 0 && (
              <div className="border-t border-border/40 bg-background/40 px-4 py-2.5">
                <div className="scrollbar-none flex items-center gap-2 overflow-x-auto">
                  {quickActions.map((action) => (
                    <QuickActionChip
                      key={action.id}
                      action={action}
                      onClick={() => handleQuickAction(action)}
                      disabled={busy}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ─── Footer: voice panel OR composer ────────── */}
            {voiceMode ? (
              <div className="border-t border-border/40 bg-gradient-to-b from-transparent to-primary/[0.04] px-5 py-5">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-10 items-center justify-center gap-[3px]">
                    {isListening ? (
                      [...Array(16)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-[2px] rounded-full bg-primary"
                          animate={{
                            height: [4, 4 + micLevel * 26, 4],
                            opacity: [0.5, 0.9, 0.5],
                          }}
                          transition={{
                            duration: 0.5 + (i % 4) * 0.08,
                            repeat: Infinity,
                            delay: i * 0.05,
                            ease: "easeInOut",
                          }}
                        />
                      ))
                    ) : isSpeaking ? (
                      [...Array(16)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-[2px] rounded-full bg-[hsl(var(--chart-3))]"
                          animate={{ height: [6, 22, 6] }}
                          transition={{
                            duration: 0.8,
                            repeat: Infinity,
                            delay: i * 0.06,
                            ease: "easeInOut",
                          }}
                        />
                      ))
                    ) : busy ? (
                      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <motion.span
                          className="inline-block h-1.5 w-1.5 rounded-full bg-warning"
                          animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.2, repeat: Infinity }}
                        />
                        Thinking…
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        Ready to listen
                      </div>
                    )}
                  </div>

                  <p className="text-[11.5px] text-muted-foreground">
                    {isListening
                      ? "Listening — speak naturally"
                      : isSpeaking
                      ? "Speaking — tap mic to interrupt"
                      : busy
                      ? "Working on a reply…"
                      : "Tap the mic to end voice mode"}
                  </p>

                  <button
                    type="button"
                    onClick={handleVoiceClick}
                    className={cn(
                      "grid h-12 w-12 place-items-center rounded-full transition-all",
                      "bg-destructive text-destructive-foreground shadow-lg shadow-destructive/30 hover:bg-destructive/90 hover:shadow-destructive/40",
                    )}
                    title="Stop voice conversation"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t border-border/40 bg-background/40 px-4 pb-3.5 pt-3">
                <form
                  name="ai-text-input"
                  onSubmit={handleSubmit}
                  className={cn(
                    "relative flex items-end gap-1 rounded-2xl border border-border/60 bg-background",
                    "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.01)] transition-all",
                    "focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]",
                  )}
                >
                  {/* Voice toggle (inside composer, left) — soft tinted
                      chip so it reads as a distinct affordance alongside
                      the primary Send button on the right. */}
                  <button
                    type="button"
                    onClick={handleVoiceClick}
                    className={cn(
                      "ml-1.5 mb-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-all",
                      "bg-primary/[0.08] text-primary/85 ring-1 ring-inset ring-primary/15",
                      "hover:bg-primary/[0.14] hover:text-primary hover:ring-primary/30",
                      "active:scale-[0.96]",
                    )}
                    title="Start voice conversation"
                    aria-label="Start voice conversation"
                  >
                    <AudioLines className="h-4 w-4" />
                  </button>

                  <ComposerTextarea
                    textareaRef={textareaRef}
                    disabled={busy}
                    onSubmit={submitDraft}
                  />

                  {/* Send (inside composer, right) */}
                  <button
                    type="submit"
                    disabled={busy}
                    className={cn(
                      "mr-1.5 mb-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-all",
                      "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
                      "disabled:cursor-not-allowed disabled:opacity-40",
                    )}
                    title="Send"
                    aria-label="Send"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </form>
                <p className="mt-2 px-1 text-center text-[10.5px] text-muted-foreground/70">
                  Press <kbd className="rounded border border-border/60 bg-background/80 px-1 font-mono text-[9.5px]">Enter</kbd> to send · <kbd className="rounded border border-border/60 bg-background/80 px-1 font-mono text-[9.5px]">Shift+Enter</kbd> for newline
                </p>
              </div>
            )}
          </motion.div>
        ) : (
          /* ─── Orb launcher (only when chat is closed) ─── */
          <motion.button
            key="orb"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            onClick={() => store.setOpen(true)}
            aria-label="Open EstateChain Copilot"
            className={cn(
              "pointer-events-auto group relative grid h-[60px] w-[60px] place-items-center rounded-full transition-shadow duration-300",
              "shadow-[0_14px_40px_-12px_hsl(var(--primary)/0.45)] hover:shadow-[0_20px_55px_-12px_hsl(var(--primary)/0.6)]",
            )}
          >
            {/* Outer breathing halo */}
            <motion.span
              className="absolute -inset-3 rounded-full bg-primary/20 blur-2xl"
              animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.95, 1.05, 0.95] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Base gradient orb */}
            <span className="absolute inset-0 rounded-full bg-gradient-to-br from-[hsl(var(--primary-soft))] via-primary to-[hsl(243_70%_38%)]" />

            {/* Inner glass highlight */}
            <span className="absolute inset-[1.5px] rounded-full bg-gradient-to-br from-white/35 via-white/5 to-transparent" />

            {/* Specular highlight */}
            <span className="absolute left-3 top-2.5 h-3.5 w-3.5 rounded-full bg-white/55 blur-[6px]" />

            {/* Soft inner ring */}
            <span className="absolute inset-[3px] rounded-full ring-1 ring-inset ring-white/15" />

            {/* Icon */}
            <span className="relative grid h-full w-full place-items-center text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
              {voiceMode ? <Mic className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
            </span>

            {/* Status ping */}
            {!voiceMode ? (
              <motion.span
                className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-primary ring-2 ring-background"
                animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2.2, repeat: Infinity }}
              />
            ) : (
              <motion.span
                className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-destructive ring-2 ring-background"
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              />
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
