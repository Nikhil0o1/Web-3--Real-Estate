"use client";

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Building2, ChevronLeft, ChevronRight, MoreHorizontal, Search } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { cn, formatCurrency, formatNumber, percent, shortAddress } from "@/lib/utils";
import type { Property } from "@/lib/types";
import { pickColor } from "@/lib/charts";

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

const PAGE_SIZE = 5;

export function PropertiesOverviewTable({
  properties,
  loading,
  onSelectProperty,
  selectedId,
}: {
  properties: Property[];
  loading?: boolean;
  onSelectProperty?: (p: Property) => void;
  selectedId?: number | null;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return properties;
    const q = search.toLowerCase();
    return properties.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.location || "").toLowerCase().includes(q),
    );
  }, [properties, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const previewQueries = useQueries({
    queries: visible.map((p) => ({
      queryKey: ["preview-distribution", p.id],
      queryFn: () => api.get<PreviewResponse>(`/tenant/preview-distribution/${p.id}`),
      enabled: !!p.token_address,
      retry: false,
      refetchInterval: 20_000,
    })),
  });

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Properties Overview</h3>
            <p className="text-xs text-muted-foreground">
              Click a row to drill into investor breakdown.
            </p>
          </div>
        </div>
        <div className="flex w-full max-w-xs items-center gap-2">
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search property…"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">#</TableHead>
            <TableHead>Property</TableHead>
            <TableHead className="text-right">Total Tokens</TableHead>
            <TableHead className="w-[260px]">Distribution</TableHead>
            <TableHead className="text-right">Token Price</TableHead>
            <TableHead>Investors</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && properties.length === 0 ? (
            Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                <TableCell colSpan={7}>
                  <Skeleton className="h-10 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                No properties to show.
              </TableCell>
            </TableRow>
          ) : (
            visible.map((p, idx) => {
              const breakdown = previewQueries[idx]?.data?.breakdown;
              const investorCount = breakdown?.length ?? 0;
              const soldPct = Number(p.sold_percentage ?? 0);
              const tokensSold = Number(p.tokens_sold ?? 0);
              const tokensTotal = Number(p.token_supply ?? 0);
              const priceEth = p.token_sale_price_eth ?? "0";
              const isSelected = selectedId === p.id;
              return (
                <TableRow
                  key={p.id}
                  data-state={isSelected ? "selected" : undefined}
                  onClick={() => onSelectProperty?.(p)}
                  className="cursor-pointer"
                >
                  <TableCell className="text-muted-foreground">{(safePage - 1) * PAGE_SIZE + idx + 1}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-xs font-semibold text-white"
                        style={{ background: pickColor(p.id) }}
                      >
                        {p.token_symbol?.slice(0, 2) || "PR"}
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{p.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{p.location}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(tokensTotal)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium tabular-nums">
                          {formatNumber(tokensSold)} ({soldPct.toFixed(1)}%)
                        </span>
                      </div>
                      <Progress
                        value={soldPct}
                        className="h-1.5"
                        indicatorClassName={cn(
                          soldPct >= 60 ? "bg-success" : soldPct >= 30 ? "bg-chart-2" : "bg-chart-4",
                        )}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(priceEth).toFixed(4)} ETH
                  </TableCell>
                  <TableCell>
                    <InvestorAvatars
                      breakdown={breakdown}
                      isLoading={previewQueries[idx]?.isLoading && !!p.token_address}
                      hasToken={!!p.token_address}
                      hasRent={Number(p.monthly_rent_eth ?? 0) > 0}
                      count={investorCount}
                    />
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
        <span>
          Page {safePage} / {totalPages} · {filtered.length} {filtered.length === 1 ? "property" : "properties"}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          {Array.from({ length: totalPages }).map((_, i) => (
            <Button
              key={i}
              variant={i + 1 === safePage ? "default" : "outline"}
              size="sm"
              className="h-7 min-w-7 px-2 text-xs"
              onClick={() => setPage(i + 1)}
            >
              {i + 1}
            </Button>
          ))}
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function InvestorAvatars({
  breakdown,
  isLoading,
  hasToken,
  hasRent,
  count,
}: {
  breakdown?: PreviewBreakdownItem[];
  isLoading?: boolean;
  hasToken: boolean;
  hasRent: boolean;
  count: number;
}) {
  if (!hasToken) return <span className="text-xs text-muted-foreground">No token deployed</span>;
  if (isLoading) return <Skeleton className="h-6 w-24" />;
  if (!breakdown || breakdown.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        {hasRent ? "No investors yet" : "Set rent to view"}
      </span>
    );
  }
  const display = breakdown.slice(0, 4);
  const more = count - display.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {display.map((it) => (
        <motion.span
          key={it.investor}
          whileHover={{ y: -2 }}
          className="grid h-6 w-6 place-items-center rounded-full border-2 border-card bg-muted font-mono text-[9px]"
          title={it.investor}
        >
          {shortAddress(it.investor, 1, 1).replace("…", "")}
        </motion.span>
      ))}
      {more > 0 ? (
        <Badge variant="muted" className="ml-2 h-6 rounded-full px-2 text-[10px]">
          +{more}
        </Badge>
      ) : null}
    </div>
  );
}
