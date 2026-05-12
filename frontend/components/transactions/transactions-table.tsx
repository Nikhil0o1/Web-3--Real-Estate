"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  Coins,
  ExternalLink,
  Receipt,
  RefreshCw,
  Search,
  Wallet,
} from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty";
import { txExplorerUrl } from "@/lib/runtime-config";
import { cn, formatDateTime, shortAddress } from "@/lib/utils";
import type { Transaction } from "@/lib/types";

const PAGE_SIZE = 12;

const TYPE_META: Record<string, { color: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  investment: { color: "bg-chart-1/15 text-chart-1", icon: Coins, label: "Investment" },
  rent_payment: { color: "bg-chart-2/15 text-chart-2", icon: Receipt, label: "Rent Payment" },
  rent_distribution: { color: "bg-chart-3/15 text-chart-3", icon: ArrowDownToLine, label: "Rent Distribution" },
  rent_claim: { color: "bg-chart-4/15 text-chart-4", icon: Wallet, label: "Rent Claim" },
  property_listing: { color: "bg-chart-5/15 text-chart-5", icon: Building2, label: "Property Listing" },
  property_token_deployment: { color: "bg-chart-6/15 text-chart-6", icon: RefreshCw, label: "Token Deployed" },
  default: { color: "bg-muted text-muted-foreground", icon: Receipt, label: "Transaction" },
};

function statusBadge(status?: string) {
  const s = (status || "").toLowerCase();
  if (s === "completed" || s === "confirmed" || s === "success")
    return <Badge variant="success">Completed</Badge>;
  if (s === "pending" || s === "queued") return <Badge variant="warning">Pending</Badge>;
  if (s === "failed" || s === "reverted") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="muted">{status || "—"}</Badge>;
}

export function TransactionsTable({
  transactions,
  loading,
}: {
  transactions: Transaction[];
  loading?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<Transaction | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return transactions;
    const q = search.toLowerCase();
    return transactions.filter(
      (t) =>
        t.tx_hash?.toLowerCase().includes(q) ||
        t.wallet_address?.toLowerCase().includes(q) ||
        t.property_name?.toLowerCase().includes(q) ||
        t.action_label?.toLowerCase().includes(q),
    );
  }, [transactions, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
            placeholder="Search by hash, wallet, property…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} transaction{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Type</TableHead>
            <TableHead>Property</TableHead>
            <TableHead>Wallet</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && transactions.length === 0 ? (
            Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                <TableCell colSpan={7}>
                  <Skeleton className="h-9 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-10">
                <EmptyState title="No transactions" description="Activity will appear here as it gets indexed." />
              </TableCell>
            </TableRow>
          ) : (
            visible.map((t) => {
              const meta = TYPE_META[t.type] || TYPE_META.default;
              const Icon = meta.icon;
              return (
                <TableRow
                  key={t.id ?? t.tx_hash}
                  className="cursor-pointer"
                  onClick={() => setActive(t)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className={cn("grid h-7 w-7 place-items-center rounded-md", meta.color)}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-xs font-medium">{meta.label}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">
                      {t.property_name || (t.property_id ? `#${t.property_id}` : "—")}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {t.wallet_address ? shortAddress(t.wallet_address, 6, 4) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className="text-sm font-medium">{t.display_amount}</span>
                    <span className="ml-1 text-xs text-muted-foreground">{t.amount_unit}</span>
                  </TableCell>
                  <TableCell>{statusBadge(t.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(t.timestamp)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <ArrowUpRight className="h-3.5 w-3.5" />
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
          <span className="px-2 tabular-nums">{safePage}</span>
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

      <TransactionDialog tx={active} onClose={() => setActive(null)} />
    </div>
  );
}

function TransactionDialog({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  if (!tx) return null;
  const meta = TYPE_META[tx.type] || TYPE_META.default;
  const Icon = meta.icon;
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className={cn("grid h-9 w-9 place-items-center rounded-md", meta.color)}>
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle>{meta.label}</DialogTitle>
              <DialogDescription>{tx.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Row label="Status" value={statusBadge(tx.status)} />
          <Row label="Amount" value={`${tx.display_amount} ${tx.amount_unit}`} />
          <Row label="Property" value={tx.property_name || (tx.property_id ? `#${tx.property_id}` : "—")} />
          <Row label="Wallet" value={tx.wallet_address ? <span className="font-mono text-xs">{tx.wallet_address}</span> : "—"} />
          <Row label="Block" value={tx.block_number ?? "—"} />
          <Row label="Date" value={formatDateTime(tx.timestamp)} />
          {tx.gas_fee ? <Row label="Gas Fee" value={`${tx.gas_fee} ETH`} /> : null}
          {tx.amount_spent ? <Row label="Amount Spent" value={`${tx.amount_spent} ETH`} /> : null}
          {tx.remaining_balance ? <Row label="Remaining Balance" value={`${tx.remaining_balance} ETH`} /> : null}
        </div>
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Transaction Hash</div>
          <div className="mt-1 break-all font-mono text-xs">{tx.tx_hash}</div>
        </div>
        <a
          href={txExplorerUrl(tx.tx_hash)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          View on Etherscan <ExternalLink className="h-3 w-3" />
        </a>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}
