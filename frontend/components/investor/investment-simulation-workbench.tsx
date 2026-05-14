"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FlaskConical, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn, formatCurrency } from "@/lib/utils";
import { pickColor } from "@/lib/charts";
import { useReducedMotionFlag } from "@/lib/motion";

export type SimulationSlice = { id: number; name: string; value: number };

function herfindahl(weights: number[]) {
  return weights.reduce((s, w) => s + w * w, 0);
}

export function InvestmentSimulationWorkbench({
  slices,
  totalValue,
  loading,
}: {
  slices: SimulationSlice[];
  totalValue: number;
  loading?: boolean;
}) {
  const reduced = useReducedMotionFlag();
  const gid = useId().replace(/:/g, "");
  const [targetYield, setTargetYield] = useState(6.5);
  /** Positive allocation points — normalized for scenario math. */
  const [pts, setPts] = useState<Record<number, number>>({});

  const dataSig = useMemo(() => JSON.stringify(slices.map((s) => [s.id, s.value])), [slices]);

  useEffect(() => {
    if (!slices.length) {
      setPts({});
      return;
    }
    const next: Record<number, number> = {};
    for (const s of slices) {
      next[s.id] = Math.max(1, Math.round(s.value * 100));
    }
    setPts(next);
  }, [dataSig, slices]);

  const sumPts = useMemo(() => slices.reduce((a, s) => a + (pts[s.id] ?? 1), 0) || 1, [slices, pts]);

  const normalized = useMemo(
    () =>
      slices.map((s) => ({
        id: s.id,
        name: s.name,
        value: s.value,
        w: (pts[s.id] ?? 1) / sumPts,
      })),
    [slices, pts, sumPts],
  );

  const currentH = useMemo(() => {
    if (!slices.length) return 0;
    const sumVal = slices.reduce((a, s) => a + s.value, 0) || 1;
    const w = slices.map((s) => s.value / sumVal);
    return herfindahl(w);
  }, [slices]);

  const simH = useMemo(() => herfindahl(normalized.map((n) => n.w)), [normalized]);

  const diversificationDelta = currentH - simH;
  const illustrativeIncome = (totalValue * (targetYield / 100)) / 12;

  const chartData = normalized.map((n, i) => ({
    name: n.name,
    current: slices.find((s) => s.id === n.id)?.value ?? 0,
    simulated: totalValue * n.w,
    fill: pickColor(i),
  }));

  if (loading || slices.length === 0) {
    return null;
  }

  return (
    <Card className="overflow-hidden border-border/70 bg-card/60 shadow-[0_24px_70px_-50px_rgba(0,0,0,0.65)] backdrop-blur-md">
      <CardHeader className="border-b border-border/50 bg-muted/10">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4 text-chart-3" />
          Investment sandbox
        </CardTitle>
        <CardDescription>
          Interactive allocation model — illustrative only, not execution advice. Rebalance weights to explore concentration vs. diversification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            {normalized.map((row, idx) => (
              <div key={row.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <Label className="truncate font-normal text-foreground">{row.name}</Label>
                  <span className="tabular-nums text-muted-foreground">{(row.w * 100).toFixed(1)}%</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={5000}
                  step={1}
                  value={pts[row.id] ?? 1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setPts((prev) => ({ ...prev, [row.id]: Math.max(1, v) }));
                  }}
                  className="h-1.5 w-full cursor-pointer accent-primary"
                  style={{ accentColor: pickColor(idx) }}
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const next: Record<number, number> = {};
                  for (const s of slices) next[s.id] = 1000;
                  setPts(next);
                }}
                className={cn(
                  "rounded-md border border-border/70 bg-background/60 px-3 py-1.5 text-[11px] font-medium",
                  "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                Equal weight
              </button>
              <button
                type="button"
                onClick={() => {
                  const next: Record<number, number> = {};
                  for (const s of slices) {
                    next[s.id] = Math.max(1, Math.round(s.value * 100));
                  }
                  setPts(next);
                }}
                className={cn(
                  "rounded-md border border-border/70 bg-background/60 px-3 py-1.5 text-[11px] font-medium",
                  "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                Match current book
              </button>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-3">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              Scenario metrics
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Metric label="Concentration (H)" value={simH.toFixed(3)} hint="Lower is more diversified" />
              <Metric
                label="Δ vs current"
                value={`${diversificationDelta >= 0 ? "+" : ""}${diversificationDelta.toFixed(3)}`}
                hint="Positive means less concentrated"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Illustrative gross yield % (annual)</Label>
              <input
                type="range"
                min={1}
                max={18}
                step={0.1}
                value={targetYield}
                onChange={(e) => setTargetYield(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-chart-3"
              />
              <p className="text-[11px] text-muted-foreground">
                Not from chain oracles — sandbox input. Monthly illustration:{" "}
                <span className="font-medium text-foreground">{formatCurrency(illustrativeIncome)}</span> on{" "}
                {formatCurrency(totalValue)} at {targetYield.toFixed(1)}% / yr.
              </p>
            </div>
          </div>
        </div>

        <motion.div
          initial={false}
          animate={reduced ? undefined : { opacity: [0.92, 1, 0.92] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          className="h-[220px] w-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`simFill-${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={0} angle={-18} textAnchor="end" height={48} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => formatCurrency(Number(v))} width={72} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover) / 0.96)",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number | string, name: string) => [
                  formatCurrency(Number(v)),
                  name === "current" ? "Current est." : "Simulated",
                ]}
              />
              <Area
                type="monotone"
                dataKey="current"
                stroke="hsl(var(--muted-foreground))"
                fillOpacity={0}
                strokeWidth={1.5}
                name="current"
                isAnimationActive={!reduced}
              />
              <Area
                type="monotone"
                dataKey="simulated"
                stroke="hsl(var(--primary))"
                fill={`url(#simFill-${gid})`}
                strokeWidth={2}
                name="simulated"
                isAnimationActive={!reduced}
              />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">{value}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}
