"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ExternalLink, Mail, Search, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty";
import { api } from "@/lib/api";
import { cn, formatNumber, percent, shortAddress } from "@/lib/utils";
import { pickColor } from "@/lib/charts";
import type { Property, UserRecord } from "@/lib/types";

type PreviewBreakdownItem = {
  investor: string;
  payout_wei: number;
  ownership_pct: number;
  ownership_bps: number;
};

type PreviewResponse = {
  property_id: number;
  property_name: string;
  breakdown: PreviewBreakdownItem[];
};

type InvestorRow = {
  wallet: string;
  user?: UserRecord;
  positions: { property: Property; ownershipPct: number }[];
  totalOwnershipBps: number;
};

const PAGE_SIZE = 12;

export function InvestorsTable({
  users,
  properties,
  loading,
}: {
  users: UserRecord[];
  properties: Property[];
  loading?: boolean;
}) {
  const previews = useQueries({
    queries: properties
      .filter((p) => !!p.token_address)
      .map((p) => ({
        queryKey: ["preview-distribution", p.id],
        queryFn: () => api.get<PreviewResponse>(`/tenant/preview-distribution/${p.id}`),
        enabled: !!p.id,
        retry: false,
        refetchInterval: 30_000,
      })),
  });

  const investors = useMemo<InvestorRow[]>(() => {
    const map = new Map<string, InvestorRow>();
    const userByWallet = new Map(users.map((u) => [u.wallet_address.toLowerCase(), u]));

    properties
      .filter((p) => !!p.token_address)
      .forEach((p, idx) => {
        const breakdown = previews[idx]?.data?.breakdown ?? [];
        breakdown.forEach((b) => {
          const key = b.investor.toLowerCase();
          const existing = map.get(key) || {
            wallet: b.investor,
            user: userByWallet.get(key),
            positions: [],
            totalOwnershipBps: 0,
          };
          existing.positions.push({ property: p, ownershipPct: b.ownership_pct });
          existing.totalOwnershipBps += b.ownership_bps;
          map.set(key, existing);
        });
      });

    return Array.from(map.values()).sort((a, b) => b.totalOwnershipBps - a.totalOwnershipBps);
  }, [previews, properties, users]);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [active, setActive] = useState<InvestorRow | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return investors;
    const q = search.toLowerCase();
    return investors.filter(
      (it) => it.wallet.toLowerCase().includes(q) || it.user?.email?.toLowerCase().includes(q),
    );
  }, [investors, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const previewLoading = previews.some((p) => p.isLoading);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-center md:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by wallet or email…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} investor{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Investor</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>KYC</TableHead>
            <TableHead className="text-right">Properties</TableHead>
            <TableHead className="text-right">Avg ownership</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(loading || previewLoading) && investors.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                <TableCell colSpan={6}>
                  <Skeleton className="h-9 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10">
                <EmptyState
                  title="No investors yet"
                  description="Investor activity will appear here as token sales settle."
                />
              </TableCell>
            </TableRow>
          ) : (
            visible.map((it) => {
              const avgPct = it.positions.length
                ? it.positions.reduce((acc, p) => acc + p.ownershipPct, 0) / it.positions.length
                : 0;
              return (
                <TableRow key={it.wallet} className="cursor-pointer" onClick={() => setActive(it)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span
                        className="grid h-8 w-8 place-items-center rounded-full font-mono text-[10px] text-white"
                        style={{ background: pickColor(it.wallet.length) }}
                      >
                        {it.wallet.slice(2, 4).toUpperCase()}
                      </span>
                      <div className="flex flex-col">
                        <span className="font-mono text-xs">{shortAddress(it.wallet, 6, 4)}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {it.user?.id ? `Member #${it.user.id}` : "Unregistered"}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {it.user?.email ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <KycBadge value={it.user?.kyc_status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {it.positions.length}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {avgPct.toFixed(2)}%
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <ExternalLink className="h-3.5 w-3.5" />
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
          Page {safePage} / {totalPages}
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

      <InvestorDetailsDialog row={active} onClose={() => setActive(null)} />
    </div>
  );
}

function KycBadge({ value }: { value?: string }) {
  const v = (value || "").toLowerCase();
  if (v === "approved" || v === "verified") return <Badge variant="success">Verified</Badge>;
  if (v === "pending") return <Badge variant="warning">Pending</Badge>;
  if (v === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="muted">—</Badge>;
}

function InvestorDetailsDialog({
  row,
  onClose,
}: {
  row: InvestorRow | null;
  onClose: () => void;
}) {
  const enabled = !!row?.wallet;
  const portfolio = useQuery({
    queryKey: ["portfolio", row?.wallet],
    queryFn: () =>
      api.get<{ holdings: Array<{ property_id: number; property_name: string; token_amount: string }> }>(
        `/portfolio/${row?.wallet}`,
      ),
    enabled,
    retry: false,
  });

  if (!row) return null;
  const totalAvg = row.positions.length
    ? row.positions.reduce((acc, p) => acc + p.ownershipPct, 0) / row.positions.length
    : 0;
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span
              className="grid h-10 w-10 place-items-center rounded-full font-mono text-xs text-white"
              style={{ background: pickColor(row.wallet.length) }}
            >
              {row.wallet.slice(2, 4).toUpperCase()}
            </span>
            <div>
              <DialogTitle>{shortAddress(row.wallet, 8, 6)}</DialogTitle>
              <DialogDescription>
                {row.positions.length} position{row.positions.length === 1 ? "" : "s"} ·{" "}
                avg ownership {totalAvg.toFixed(2)}%
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Pair icon={<Wallet className="h-3.5 w-3.5" />} label="Wallet" value={<span className="font-mono text-xs break-all">{row.wallet}</span>} />
          <Pair icon={<Mail className="h-3.5 w-3.5" />} label="Email" value={row.user?.email ?? "—"} />
          <Pair label="KYC" value={<KycBadge value={row.user?.kyc_status} />} />
          <Pair label="Member ID" value={row.user?.id ? `#${row.user.id}` : "Unregistered"} />
        </div>
        <div className="rounded-md border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Positions</span>
            <span>Ownership</span>
          </div>
          <div className="max-h-72 overflow-auto scrollbar-thin">
            {row.positions.map((p, idx) => {
              const holding = portfolio.data?.holdings?.find((h) => h.property_id === p.property.id);
              const tokens = holding ? Number(holding.token_amount) / 1e18 : null;
              return (
                <div
                  key={p.property.id}
                  className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 last:border-0"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[10px] font-bold text-white"
                      style={{ background: pickColor(p.property.id) }}
                    >
                      {p.property.token_symbol?.slice(0, 2) || "PR"}
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{p.property.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {tokens != null ? `${formatNumber(tokens)} tokens` : "—"}
                      </span>
                    </div>
                  </div>
                  <span className="tabular-nums text-sm font-medium">
                    {p.ownershipPct.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Pair({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
