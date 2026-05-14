"use client";

import { motion } from "framer-motion";
import { AlertTriangle, Bot, GaugeCircle, Sparkles, TerminalSquare } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useInvestorCopilotStore } from "@/lib/ai/investor-copilot-store";
import { formatDateTime } from "@/lib/utils";

function iconFor(kind: string) {
  if (kind === "error") return AlertTriangle;
  if (kind === "progress") return GaugeCircle;
  if (kind === "execution") return TerminalSquare;
  if (kind === "recommendation") return Sparkles;
  return Bot;
}

export function AiActivityFeed() {
  const activities = useInvestorCopilotStore((s) => s.activities);

  return (
    <Card className="overflow-hidden border-border/70 bg-card/60 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-sm">AI Activity Feed</CardTitle>
        <CardDescription>Live orchestration and recommendation events.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {activities.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            No AI activity yet. Ask Copilot to analyze your portfolio.
          </div>
        ) : (
          activities.slice(0, 8).map((item, index) => {
            const Icon = iconFor(item.kind);
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.15) }}
                className="rounded-lg border border-border/70 bg-muted/20 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-background/70 text-primary">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{item.message}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                    </div>
                  </div>
                  <Badge variant={item.kind === "error" ? "destructive" : "muted"} className="rounded-md text-[10px]">
                    {item.kind}
                  </Badge>
                </div>
              </motion.div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
