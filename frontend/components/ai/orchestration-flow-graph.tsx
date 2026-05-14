"use client";

import { motion } from "framer-motion";
import { Bot, Brain, GitBranch, Link2, ShieldCheck, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotionFlag } from "@/lib/motion";

type Stage = "idle" | "stream" | "wallet";

function Node({
  label,
  sub,
  icon: Icon,
  active,
  reduced,
}: {
  label: string;
  sub: string;
  icon: typeof Bot;
  active: boolean;
  reduced: boolean;
}) {
  return (
    <motion.div
      className={cn(
        "relative flex min-w-[72px] flex-1 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-center",
        active
          ? "border-primary/45 bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.12)]"
          : "border-border/60 bg-card/40 opacity-70",
      )}
      animate={active && !reduced ? { y: [0, -1, 0] } : { y: 0 }}
      transition={{ duration: 2.4, repeat: active ? Infinity : 0, ease: "easeInOut" }}
    >
      <Icon className={cn("h-3.5 w-3.5", active ? "text-primary" : "text-muted-foreground")} />
      <span className="text-[10px] font-semibold leading-tight text-foreground">{label}</span>
      <span className="text-[9px] leading-tight text-muted-foreground">{sub}</span>
    </motion.div>
  );
}

export function OrchestrationFlowGraph({
  streaming,
  executing,
}: {
  streaming: boolean;
  executing: boolean;
}) {
  const reduced = useReducedMotionFlag();
  const stage: Stage = executing ? "wallet" : streaming ? "stream" : "idle";

  return (
    <div className="rounded-xl border border-border/60 bg-gradient-to-b from-muted/15 to-background/30 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 text-primary" />
          Runtime graph
        </span>
        <span className="tabular-nums text-muted-foreground/80">{stage === "idle" ? "Standby" : stage === "stream" ? "Graph active" : "Wallet gate"}</span>
      </div>
      <div className="flex flex-wrap items-stretch justify-between gap-2">
        <Node label="Role" sub="Policy" icon={ShieldCheck} active={stage !== "idle"} reduced={reduced} />
        <Node label="Graph" sub="LangGraph" icon={Bot} active={stage === "stream" || stage === "wallet"} reduced={reduced} />
        <Node label="Tools" sub="Registry" icon={Wrench} active={stage === "stream"} reduced={reduced} />
        <Node label="Cognition" sub="Hybrid" icon={Brain} active={stage === "stream"} reduced={reduced} />
        <Node label="MetaMask" sub="Human" icon={Link2} active={stage === "wallet"} reduced={reduced} />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Visual map of the non-custodial boundary: AI prepares, you sign, chain settles.
      </p>
    </div>
  );
}
