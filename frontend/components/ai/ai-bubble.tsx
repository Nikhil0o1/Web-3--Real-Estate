"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  AudioLines,
  BarChart3,
  ChevronDown,
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/lib/ai/agent-store";
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

/** Soft pastel tint per quick-action slot (reference-style colored icon tiles). */
const ACTION_TINTS: { bg: string; ring: string; icon: string }[] = [
  { bg: "bg-sky-500/12", ring: "ring-sky-500/30", icon: "text-sky-600 dark:text-sky-400" },
  { bg: "bg-emerald-500/12", ring: "ring-emerald-500/30", icon: "text-emerald-600 dark:text-emerald-400" },
  { bg: "bg-violet-500/12", ring: "ring-violet-500/30", icon: "text-violet-600 dark:text-violet-400" },
  { bg: "bg-amber-500/12", ring: "ring-amber-500/30", icon: "text-amber-600 dark:text-amber-400" },
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

function getStatePill(state: string) {
  if (state === "thinking" || state === "transcribing")
    return { label: "Thinking", dot: "bg-amber-400" };
  if (state === "listening" || state === "recording")
    return { label: "Listening", dot: "bg-emerald-400" };
  if (state === "speaking")
    return { label: "Speaking", dot: "bg-violet-400" };
  if (state === "error")
    return { label: "Offline", dot: "bg-rose-400" };
  return { label: "Online", dot: "bg-emerald-400" };
}

/**
 * Big "card" style quick action — used in the welcome state when the user
 * hasn't started a conversation yet. Mirrors the reference image's
 * "Ticket enquiry / Check status / Create new ticket" rows.
 */
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
        "group flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-background/60 p-3 text-left",
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
        <span className="block truncate text-[13px] font-semibold tracking-tight text-foreground">
          {action.label}
        </span>
        <span className="mt-0.5 line-clamp-1 block text-[11px] text-muted-foreground">
          {action.prompt}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
    </motion.button>
  );
}

/**
 * Compact "list row" used after a conversation has started — slimmer than
 * the welcome cards but still a one-row-per-action vertical list (no
 * horizontal scrolling).
 */
function QuickActionRow({
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
      whileHover={{ x: 1 }}
      whileTap={{ scale: 0.99 }}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-xl border border-border/60 bg-background/70 px-2.5 py-2 text-left",
        "transition-all hover:border-primary/40 hover:bg-primary/[0.04]",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1",
          tint.bg,
          tint.ring,
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", tint.icon)} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium tracking-tight text-foreground">
        {action.label}
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-primary" />
    </motion.button>
  );
}

export function AIBubble() {
  const router = useRouter();
  const pathname = usePathname();
  const draftRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const store = useAgentStore();
  const { open, messages, state, error, voiceMode, micLevel } = store;

  const role = useMemo(() => getRoleFromPath(pathname), [pathname]);
  const quickActions = useMemo(() => getQuickActions(role), [role]);
  const roleLabel = useMemo(() => getRoleLabel(role), [role]);

  // Reference-style breadcrumb subtitle e.g. "Investor · Portfolio · Yield".
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draftRef.current?.value ?? "";
    if (!text.trim() || state === "thinking") return;
    if (draftRef.current) draftRef.current.value = "";
    void store.send(text, router, { fromVoice: false });
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
      await store.enterVoiceMode(router);
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
      className="pointer-events-none fixed bottom-6 right-6 z-[100] flex w-auto flex-col items-end gap-0"
    >
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              // Wider, roomier shell — expands further toward the left so the
              // transcript + action list aren't cramped.
              "pointer-events-auto mb-3 flex w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden",
              // Hard cap so the shell never grows above the orb / off-screen as
              // the transcript fills up. Uses dynamic viewport units when the
              // browser supports them (mobile address-bar safe).
              "max-h-[min(760px,calc(100dvh-7rem))]",
              "rounded-[28px] border border-border/50 bg-card/95 backdrop-blur-2xl",
              "shadow-[0_24px_80px_-20px_rgba(0,0,0,0.4),0_2px_8px_-2px_rgba(0,0,0,0.08)]",
              "ring-1 ring-foreground/[0.03]",
            )}
          >
            {/* ─── Header ───────────────────────────────────── */}
            <div className="relative flex items-center gap-3 border-b border-border/40 bg-gradient-to-b from-foreground/[0.02] to-transparent px-4 py-3.5">
              {/* Mini orb avatar */}
              <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full">
                <span className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-300 via-emerald-500 to-emerald-700" />
                <span className="absolute inset-[2px] rounded-full bg-gradient-to-br from-white/30 via-transparent to-transparent" />
                <MessageSquare className="relative h-[18px] w-[18px] text-white drop-shadow-sm" />
              </div>

              <div className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold leading-tight tracking-tight text-foreground">
                  EstateChain Copilot
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-muted-foreground">
                  {subtitle}
                </span>
              </div>

              <div className="flex items-center gap-1">
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
                  title="Close"
                  className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground/70 transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* ─── Status row (just under header) ───────────── */}
            <div className="flex items-center justify-between border-b border-border/30 bg-background/40 px-4 py-1.5">
              <div className="flex items-center gap-1.5">
                <motion.span
                  className={cn("h-1.5 w-1.5 rounded-full", pill.dot)}
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                />
                <span className="text-[11px] font-medium text-muted-foreground">{pill.label}</span>
              </div>
              <span className="truncate text-[11px] text-muted-foreground/80">{roleLabel}</span>
            </div>

            {/* ─── Transcript ───────────────────────────────── */}
            <div
              ref={scrollRef}
              className="scrollbar-thin relative flex min-h-0 flex-1 flex-col overflow-y-auto scroll-smooth"
            >
              <div className="flex flex-1 flex-col gap-3 px-4 py-4">
                {showWelcome ? (
                  <>
                    {/* Welcome message — sits like an assistant bubble. */}
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 text-white shadow-sm ring-1 ring-emerald-500/20">
                        <Sparkles className="h-3 w-3" />
                      </div>
                      <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-border/50 bg-background/80 px-3.5 py-2.5 text-[13px] leading-relaxed text-foreground">
                        Welcome back! What would you like to do today?
                      </div>
                    </div>

                    {quickActions.length > 0 && (
                      <div className="mt-1">
                        <p className="mb-2 px-1 text-[12px] font-medium text-foreground/80">
                          What would you like to do?
                        </p>
                        <div className="flex flex-col gap-2">
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
                          "flex w-full gap-2",
                          isUser ? "justify-end" : "justify-start",
                        )}
                      >
                        {!isUser && (
                          <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 text-white shadow-sm ring-1 ring-emerald-500/20">
                            <Sparkles className="h-3 w-3" />
                          </div>
                        )}
                        <div
                          className={cn(
                            "max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
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
                        className="flex items-end gap-2"
                      >
                        <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 text-white shadow-sm ring-1 ring-emerald-500/20">
                          <Sparkles className="h-3 w-3" />
                        </div>
                        <div className="rounded-2xl rounded-bl-md border border-border/50 bg-background/80 px-3 py-2">
                          <ThinkingDots />
                        </div>
                      </motion.div>
                    )}
                </AnimatePresence>

                {error && (
                  <div className="mt-1 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] leading-tight text-destructive">
                    <span className="font-semibold">Error:</span> {error}
                  </div>
                )}
              </div>
            </div>

            {/* ─── Quick actions (vertical list — visible AFTER a conversation has started) */}
            {!voiceMode && !showWelcome && quickActions.length > 0 && (
              <div className="border-t border-border/40 bg-gradient-to-b from-transparent to-foreground/[0.015] px-3 pb-2 pt-2.5">
                <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                  Quick actions
                </p>
                <div className="flex flex-col gap-1.5">
                  {quickActions.map((action, idx) => (
                    <QuickActionRow
                      key={action.id}
                      action={action}
                      tint={ACTION_TINTS[idx % ACTION_TINTS.length]}
                      onClick={() => handleQuickAction(action)}
                      disabled={busy}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ─── Footer: text input OR voice panel ────────── */}
            {voiceMode ? (
              <div className="border-t border-border/40 bg-gradient-to-b from-transparent to-emerald-500/[0.04] px-4 py-4">
                <div className="flex flex-col items-center gap-3">
                  {/* Wave visualizer */}
                  <div className="flex h-10 items-center justify-center gap-[3px]">
                    {isListening ? (
                      [...Array(14)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-[2px] rounded-full bg-emerald-400"
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
                      [...Array(14)].map((_, i) => (
                        <motion.div
                          key={i}
                          className="w-[2px] rounded-full bg-violet-400"
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
                          className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400"
                          animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
                          transition={{ duration: 1.2, repeat: Infinity }}
                        />
                        Thinking…
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Ready to listen
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground">
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
                      "bg-rose-500 text-white shadow-lg shadow-rose-500/30 hover:bg-rose-600 hover:shadow-rose-500/40",
                    )}
                    title="Stop voice conversation"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="border-t border-border/40 bg-background/40 px-3 pt-3 pb-2.5">
                <form
                  name="ai-text-input"
                  onSubmit={handleSubmit}
                  className="relative flex items-center gap-2"
                >
                  <div className="relative flex flex-1 items-center overflow-hidden rounded-2xl border border-border/60 bg-background shadow-[inset_0_0_0_1px_rgba(0,0,0,0.01)] transition-all focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_rgba(16,185,129,0.08)]">
                    <Input
                      ref={draftRef}
                      placeholder="Type your question or request…"
                      className="h-11 border-0 bg-transparent px-3.5 text-[13px] shadow-none focus-visible:ring-0"
                      disabled={busy}
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className={cn(
                        "mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl transition-all",
                        "bg-gradient-to-br from-primary to-emerald-600 text-primary-foreground shadow-sm hover:from-primary/90 hover:to-emerald-600/90",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                      )}
                      title="Send"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleVoiceClick}
                    className={cn(
                      "relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl transition-all",
                      "border border-primary/25 bg-gradient-to-br from-primary/8 via-transparent to-emerald-500/8 text-primary",
                      "hover:border-primary/45 hover:from-primary/12 hover:to-emerald-500/12",
                    )}
                    title="Start voice conversation"
                  >
                    <AudioLines className="h-4 w-4" />
                  </button>
                </form>
                <p className="mt-1.5 text-center text-[10.5px] text-muted-foreground/70">
                  Choose an option above or type your question
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Orb launcher ─────────────────────────────────── */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.92 }}
        onClick={() => store.setOpen(!open)}
        aria-label={open ? "Close EstateChain" : "Open EstateChain"}
        className={cn(
          "pointer-events-auto group relative grid h-[60px] w-[60px] place-items-center rounded-full transition-all duration-300",
          open
            ? "shadow-[0_10px_30px_-10px_rgba(0,0,0,0.3)]"
            : "shadow-[0_14px_40px_-12px_rgba(16,185,129,0.45)] hover:shadow-[0_20px_55px_-12px_rgba(16,185,129,0.6)]",
        )}
      >
        {/* Outer breathing halo (only when closed) */}
        {!open && (
          <motion.span
            className="absolute -inset-3 rounded-full bg-emerald-400/15 blur-2xl"
            animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.95, 1.05, 0.95] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        {/* Base gradient orb */}
        <span
          className={cn(
            "absolute inset-0 rounded-full transition-all duration-500",
            open
              ? "bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900"
              : "bg-gradient-to-br from-emerald-300 via-emerald-500 to-emerald-800",
          )}
        />

        {/* Inner glass highlight */}
        <span className="absolute inset-[1.5px] rounded-full bg-gradient-to-br from-white/35 via-white/5 to-transparent" />

        {/* Subtle specular highlight */}
        <span className="absolute left-3 top-2.5 h-3.5 w-3.5 rounded-full bg-white/55 blur-[6px]" />

        {/* Soft inner ring */}
        <span className="absolute inset-[3px] rounded-full ring-1 ring-inset ring-white/15" />

        {/* Icon */}
        <span className="relative grid h-full w-full place-items-center text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
          <AnimatePresence mode="wait">
            {open ? (
              <motion.span
                key="close"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="grid place-items-center"
              >
                <ChevronDown className="h-5 w-5" />
              </motion.span>
            ) : (
              <motion.span
                key="open"
                initial={{ rotate: 90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -90, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="grid place-items-center"
              >
                {voiceMode ? <Mic className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
              </motion.span>
            )}
          </AnimatePresence>
        </span>

        {/* Status ping (when closed and idle) */}
        {!open && !voiceMode && (
          <motion.span
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-emerald-300 ring-2 ring-background"
            animate={{ scale: [1, 1.25, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2.2, repeat: Infinity }}
          />
        )}
        {!open && voiceMode && (
          <motion.span
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-rose-400 ring-2 ring-background"
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          />
        )}
      </motion.button>
    </div>
  );
}
