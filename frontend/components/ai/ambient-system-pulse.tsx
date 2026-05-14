"use client";

import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import { useStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useReducedMotionFlag } from "@/lib/motion";

export function AmbientSystemPulse({ className }: { className?: string }) {
  const status = useStatus();
  const reduced = useReducedMotionFlag();
  const ok = status.data?.database === "ok" && status.data?.rpc === "ok";

  return (
    <div
      className={cn(
        "hidden items-center gap-2 rounded-full border border-border/60 bg-card/50 px-2.5 py-1 text-[10px] text-muted-foreground backdrop-blur-sm md:flex",
        className,
      )}
      title="Ambient platform health"
    >
      <motion.span
        className={cn("relative flex h-2 w-2 rounded-full", ok ? "bg-primary" : "bg-warning")}
        animate={reduced || !ok ? undefined : { scale: [1, 1.15, 1], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <Activity className="h-3 w-3 opacity-70" />
      <span className="max-w-[140px] truncate">{ok ? "Systems nominal" : "Degraded path"}</span>
    </div>
  );
}
