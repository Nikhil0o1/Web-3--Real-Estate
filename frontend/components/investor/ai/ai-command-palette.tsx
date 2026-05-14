"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Compass, LayoutDashboard, MessageSquareText, Search, Sparkles, Wallet } from "lucide-react";
import { INVESTOR_AI_QUICK_COMMANDS, useInvestorCopilotStore } from "@/lib/ai/investor-copilot-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PaletteAction = {
  id: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void;
};

export function AiCommandPalette() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const open = useInvestorCopilotStore((s) => s.commandPaletteOpen);
  const setOpen = useInvestorCopilotStore((s) => s.setCommandPaletteOpen);
  const sendMessage = useInvestorCopilotStore((s) => s.sendMessage);

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: "nav-dashboard",
        label: "Open investor dashboard",
        hint: "Navigation",
        icon: LayoutDashboard,
        run: () => router.push("/investor"),
      },
      {
        id: "nav-marketplace",
        label: "Explore marketplace",
        hint: "Navigation",
        icon: Compass,
        run: () => router.push("/investor/marketplace"),
      },
      {
        id: "nav-portfolio",
        label: "Open portfolio",
        hint: "Navigation",
        icon: Wallet,
        run: () => router.push("/investor/portfolio"),
      },
      ...INVESTOR_AI_QUICK_COMMANDS.map((command, idx) => ({
        id: `ai-${idx}`,
        label: command,
        hint: "AI command",
        icon: Sparkles,
        run: () => void sendMessage(command),
      })),
    ],
    [router, sendMessage],
  );

  const filtered = actions.filter((a) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${a.label} ${a.hint}`.toLowerCase().includes(q);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl overflow-hidden border-border/80 bg-card/90 p-0 shadow-[0_30px_100px_-35px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <DialogHeader className="border-b border-border/70 px-5 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquareText className="h-4 w-4 text-primary" />
            AI Command Palette
          </DialogTitle>
          <DialogDescription>
            Run investor actions, navigate instantly, and trigger orchestration with <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px]">Ctrl/Cmd + K</kbd>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 border-border/70 bg-background/70 pl-9"
              placeholder="Find safest property, analyze portfolio, open marketplace…"
            />
          </div>
          <div className="max-h-[340px] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {filtered.map((action) => {
              const Icon = action.icon;
              return (
                <motion.button
                  key={action.id}
                  type="button"
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => {
                    action.run();
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "group flex w-full items-center justify-between rounded-lg border border-transparent bg-muted/20 px-3 py-2.5 text-left transition-colors",
                    "hover:border-border hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="grid h-7 w-7 place-items-center rounded-md border border-border/70 bg-background/70 text-primary">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">{action.label}</div>
                      <div className="text-[11px] text-muted-foreground">{action.hint}</div>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </motion.button>
              );
            })}
            {filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                No command matches that search.
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
