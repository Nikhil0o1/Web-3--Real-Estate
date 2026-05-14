"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Radar, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { queryKeys, useAutonomousIntelEvents, useAutonomousUnreadCount } from "@/lib/queries";
import { formatDateTime, cn } from "@/lib/utils";
import type { AutonomousIntelEvent } from "@/lib/types";

function severityBorder(sev: string) {
  if (sev === "warning") return "border-l-destructive/80";
  if (sev === "opportunity") return "border-l-emerald-500/70";
  if (sev === "critical" || sev === "error") return "border-l-destructive";
  return "border-l-primary/50";
}

export function AutonomousIntelFeed() {
  const qc = useQueryClient();
  const events = useAutonomousIntelEvents();
  const unread = useAutonomousUnreadCount();
  const markRead = useMutation({
    mutationFn: (id: number) =>
      api.post<unknown>(`/api/agents/autonomous/events/${id}/read`, {}).then(() => undefined),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.autonomousIntel });
      void qc.invalidateQueries({ queryKey: [...queryKeys.autonomousIntel, "unread"] });
    },
  });

  const list = events.data ?? [];

  return (
    <Card className="glass-panel overflow-hidden border-border/60">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Radar className="h-4 w-4 text-primary" />
            Autonomous Intelligence
          </CardTitle>
          <CardDescription>Background monitoring — advisory only; no auto-signing.</CardDescription>
        </div>
        <Badge variant="outline" className="rounded-md text-[10px]">
          <Bell className="mr-1 h-3 w-3" />
          {unread.isLoading ? "…" : `${unread.data?.count ?? 0} unread`}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
        ) : list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            No autonomous signals yet. Enable the background worker (
            <code className="text-[10px]">AUTONOMOUS_WORKER</code> or{" "}
            <code className="text-[10px]">RUN_AUTONOMOUS_AGENTS_IN_WEB</code>) to populate this feed.
          </div>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {list.slice(0, 8).map((item: AutonomousIntelEvent, index: number) => (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 8, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: -10, transition: { duration: 0.15 } }}
                transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.1), ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "rounded-lg border border-border/60 border-l-4 bg-muted/12 p-3 shadow-sm",
                  severityBorder(item.severity),
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <Badge
                        variant={
                          item.severity === "warning"
                            ? "destructive"
                            : item.severity === "opportunity"
                              ? "success"
                              : "muted"
                        }
                        className="rounded-md text-[10px]"
                      >
                        {item.severity}
                      </Badge>
                      <Badge variant="outline" className="rounded-md text-[10px]">
                        {item.category}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {item.agent} · {item.created_at ? formatDateTime(item.created_at) : ""}
                    </p>
                  </div>
                  {item.unread ? (
                    <Button
                      size="xs"
                      variant="outline"
                      className="h-7 shrink-0 text-[10px]"
                      disabled={markRead.isPending}
                      onClick={() => markRead.mutate(item.id)}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </CardContent>
    </Card>
  );
}
