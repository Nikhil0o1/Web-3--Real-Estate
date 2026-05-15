"use client";

import type { ReactNode } from "react";
import { useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, ChevronDown, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type DashboardAiCopilotDockProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function DashboardAiCopilotDock({
  eyebrow,
  title,
  description,
  children,
  defaultOpen = false,
  className,
}: DashboardAiCopilotDockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section
      className={cn(
        "overflow-hidden rounded-[28px] border border-border/70 bg-card/85 p-1.5 shadow-sm transition-colors",
        open && "border-primary/25 bg-card",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-full bg-background/80 px-3 py-2.5 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-4"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary/10 text-primary">
            <Bot className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold">{title}</span>
              <Badge variant="outline" className="rounded-full px-2 text-[10px]">
                {eyebrow}
              </Badge>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{description}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground sm:inline-flex">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {open ? "Hide console" : "Open console"}
          </span>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={contentId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-3 px-1 pb-1 pt-3 sm:px-2">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
