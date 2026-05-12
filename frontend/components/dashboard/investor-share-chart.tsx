"use client";

import { useQuery } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api } from "@/lib/api";
import { pickColor } from "@/lib/charts";
import { shortAddress } from "@/lib/utils";
import type { Property } from "@/lib/types";

type PreviewBreakdownItem = {
  investor: string;
  payout_wei: number;
  payout_eth: string;
  ownership_bps: number;
  ownership_pct: number;
};

type PreviewResponse = {
  property_id: number;
  property_name: string;
  monthly_rent_wei: string;
  investor_count: number;
  breakdown: PreviewBreakdownItem[];
};

export function InvestorShareChart({ property }: { property: Property | null }) {
  const enabled = !!property?.id && !!property?.token_address;
  const { data, isLoading, error } = useQuery({
    queryKey: ["preview-distribution", property?.id],
    queryFn: () => api.get<PreviewResponse>(`/tenant/preview-distribution/${property?.id}`),
    enabled,
    retry: false,
    refetchInterval: 20_000,
  });

  const items = data?.breakdown ?? [];
  const total = items.reduce((acc, it) => acc + (it.ownership_pct || 0), 0);
  const headerName = property?.name ?? "Investor Ownership";

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Investor Ownership — {headerName}</CardTitle>
        <CardDescription>
          {property
            ? "Live ownership percentage from the on-chain investor set."
            : "Pick a property from the bar chart or table to see the breakdown."}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid flex-1 grid-cols-1 gap-4 pt-0 md:grid-cols-2">
        <div className="relative grid place-items-center">
          {!property ? (
            <div className="grid h-[220px] place-items-center text-sm text-muted-foreground">
              Select a property
            </div>
          ) : isLoading ? (
            <Skeleton className="h-[220px] w-[220px] rounded-full" />
          ) : error || items.length === 0 ? (
            <div className="grid h-[220px] place-items-center px-4 text-center text-xs text-muted-foreground">
              {error instanceof ApiError && error.status === 400
                ? "Set monthly rent on this property to see investor distribution."
                : "No investor data yet for this property."}
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={items}
                    dataKey="ownership_pct"
                    nameKey="investor"
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={1.5}
                    stroke="hsl(var(--card))"
                    strokeWidth={2}
                  >
                    {items.map((it, i) => (
                      <Cell key={it.investor} fill={pickColor(i)} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number, _name, entry) => [
                      `${value.toFixed(2)}%`,
                      shortAddress((entry?.payload as PreviewBreakdownItem)?.investor),
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="flex flex-col items-center text-center">
                  <span className="text-xl font-semibold tabular-nums">
                    {total.toFixed(1)}%
                  </span>
                  <span className="text-[11px] text-muted-foreground">Total Allocated</span>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex min-h-[220px] flex-col gap-1.5 overflow-auto scrollbar-thin">
          <div className="grid grid-cols-[1fr_auto] gap-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Investor</span>
            <span>Ownership %</span>
          </div>
          {items.map((it, i) => (
            <div
              key={it.investor}
              className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs hover:border-border hover:bg-muted/50"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: pickColor(i) }}
                />
                <span className="truncate font-mono text-[11px] text-foreground/90" title={it.investor}>
                  {shortAddress(it.investor, 6, 4)}
                </span>
              </div>
              <span className="tabular-nums font-medium">{it.ownership_pct.toFixed(2)}%</span>
            </div>
          ))}
          {!items.length && property ? (
            <div className="grid flex-1 place-items-center text-xs text-muted-foreground">
              No investors yet.
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
