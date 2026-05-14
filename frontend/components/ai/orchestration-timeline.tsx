"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  Bot,
  Cpu,
  Sparkles,
  Terminal,
  Wallet,
  Zap,
} from "lucide-react";
import type { AiActivityItem, AiActivityKind } from "@/lib/ai/types";
import { cn, formatDateTime } from "@/lib/utils";
import { useReducedMotionFlag, springTransition } from "@/lib/motion";

function kindIcon(kind: AiActivityKind) {
  switch (kind) {
    case "lifecycle":
      return Zap;
    case "progress":
      return Terminal;
    case "recommendation":
      return Sparkles;
    case "execution":
      return Wallet;
    case "error":
      return AlertCircle;
    default:
      return Activity;
  }
}

function kindStyles(kind: AiActivityKind) {
  switch (kind) {
    case "error":
      return "border-destructive/40 bg-destructive/5 text-destructive";
    case "execution":
      return "border-primary/35 bg-primary/5 text-foreground";
    case "recommendation":
      return "border-chart-3/35 bg-chart-3/5";
    case "lifecycle":
      return "border-border/80 bg-muted/25";
    default:
      return "border-border/70 bg-background/50";
  }
}

export function OrchestrationTimeline({
  activities,
  streaming,
  maxItems = 48,
}: {
  activities: AiActivityItem[];
  streaming: boolean;
  maxItems?: number;
}) {
  const reduced = useReducedMotionFlag();
  const items = activities.slice(0, maxItems);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/50 via-border to-transparent" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Cpu className="h-3.5 w-3.5 text-primary" />
          Orchestration timeline
        </div>
        {streaming ? (
          <motion.span
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
            animate={reduced ? undefined : { opacity: [0.75, 1, 0.75] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          >
            <Bot className="h-3 w-3" />
            Live
          </motion.span>
        ) : (
          <span className="text-[10px] text-muted-foreground">Idle</span>
        )}
      </div>
      <ul className="scrollbar-thin max-h-[320px] space-y-0 overflow-y-auto pr-1">
        {items.length === 0 ? (
          <li className="rounded-lg border border-dashed border-border/80 py-6 pl-8 text-center text-xs text-muted-foreground">
            Orchestration events appear here as the graph streams cognition and tool work.
          </li>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((item, index) => {
              const Icon = kindIcon(item.kind);
              return (
                <motion.li
                  key={item.id}
                  layout={!reduced}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={springTransition(reduced)}
                  className={cn("relative mb-2 rounded-lg border pl-8 pr-2.5 py-2 text-xs leading-relaxed", kindStyles(item.kind))}
                  style={{ transitionDelay: reduced ? "0ms" : `${Math.min(index, 8) * 12}ms` }}
                >
                  <span className="absolute left-1.5 top-2.5 grid h-7 w-7 place-items-center rounded-md border border-border/60 bg-card/90 shadow-sm">
                    <Icon className="h-3.5 w-3.5 text-primary" />
                  </span>
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span>{item.kind}</span>
                    <span className="font-normal normal-case tabular-nums text-muted-foreground/80">
                      {formatDateTime(item.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-foreground/95">{item.message}</p>
                </motion.li>
              );
            })}
          </AnimatePresence>
        )}
      </ul>
    </div>
  );
}
