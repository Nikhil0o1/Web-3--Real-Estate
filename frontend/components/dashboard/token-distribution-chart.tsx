"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { pickColor } from "@/lib/charts";
import type { Property } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TokenDistributionChart({
  properties,
  loading,
  selectedId,
  onSelect,
}: {
  properties: Property[];
  loading?: boolean;
  selectedId?: number | null;
  onSelect?: (p: Property) => void;
}) {
  const data = properties
    .slice(0, 6)
    .map((p) => ({
      id: p.id,
      name: p.name?.length > 14 ? `${p.name.slice(0, 12)}…` : p.name,
      fullName: p.name,
      pct: Number(p.sold_percentage ?? 0),
      property: p,
    }));

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Token Distribution by Property</CardTitle>
            <CardDescription>% of supply sold per property — click a bar to drill in.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 pt-0">
        {loading && data.length === 0 ? (
          <Skeleton className="h-[260px] w-full" />
        ) : data.length === 0 ? (
          <div className="grid h-[260px] place-items-center text-sm text-muted-foreground">
            No properties yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data} margin={{ top: 16, right: 8, left: -10, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                domain={[0, 100]}
              />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, "Sold"]}
                labelFormatter={(label, payload) => {
                  const item = payload?.[0]?.payload;
                  return item ? item.fullName : label;
                }}
              />
              <Bar
                dataKey="pct"
                radius={[6, 6, 0, 0]}
                onClick={(item) => item?.property && onSelect?.(item.property)}
                cursor="pointer"
              >
                {data.map((d, i) => (
                  <Cell
                    key={d.id}
                    fill={pickColor(d.id)}
                    fillOpacity={selectedId == null || selectedId === d.id ? 1 : 0.3}
                    className={cn("transition-opacity")}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
