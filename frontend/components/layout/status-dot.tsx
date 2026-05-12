"use client";

import { useStatus } from "@/lib/queries";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function StatusDot({ className }: { className?: string }) {
  const { data, isError } = useStatus();
  const ok = !isError && data?.status === "ok";
  const degraded = data?.status === "degraded";
  const color = ok ? "bg-success" : degraded ? "bg-warning" : "bg-destructive";
  const label = ok
    ? "All systems operational"
    : degraded
      ? `Degraded — db ${data?.database ?? "?"}, rpc ${data?.rpc ?? "?"}`
      : "Backend unavailable";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "relative inline-flex h-2.5 w-2.5 rounded-full",
              color,
              className,
            )}
          >
            <span className={cn("absolute inset-0 rounded-full opacity-60", color, "animate-ping")} />
          </span>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
