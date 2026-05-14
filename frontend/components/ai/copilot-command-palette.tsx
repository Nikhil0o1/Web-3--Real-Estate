"use client";

import { Command, CornerDownLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function CopilotCommandPalette({
  open,
  onOpenChange,
  title,
  prompts,
  onPick,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  prompts: readonly string[];
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden border-border/80 bg-card/95 p-0 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.75)] backdrop-blur-xl">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Command className="h-4 w-4 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Jump to a governed prompt. Orchestration remains server-side; signing stays in MetaMask.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[min(60vh,420px)] overflow-y-auto scrollbar-thin p-2">
          {prompts.map((p) => (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => {
                onPick(p);
                onOpenChange(false);
              }}
              className={cn(
                "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                "hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <CornerDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="leading-snug">{p}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
          <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono">⌘</kbd>{" "}
          <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono">K</kbd> toggle ·{" "}
          <kbd className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono">Esc</kbd> close
        </div>
      </DialogContent>
    </Dialog>
  );
}
