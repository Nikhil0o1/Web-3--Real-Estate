"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Coins, Receipt, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AdminTopbar } from "@/components/layout/topbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty";
import {
  useProperties,
  useRentAnalytics,
  useRentDistributions,
  useRentPayments,
} from "@/lib/queries";
import { useSetRent, useSyncRentChain } from "@/lib/mutations";
import { cn, formatDateTime, formatEth, shortAddress } from "@/lib/utils";
import { txExplorerUrl } from "@/lib/runtime-config";
import type { Property } from "@/lib/types";

export default function RentManagementPage() {
  const properties = useProperties();
  const rent = useRentAnalytics();
  const distributions = useRentDistributions();
  const payments = useRentPayments();

  return (
    <>
      <AdminTopbar
        title="Rent Management"
        subtitle="Live rent metrics, per-property controls, payments, and distributions"
      />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            title="Total Rent Collected"
            value={formatEth(rent.data?.total_rent_collected_wei ?? "0", { fromWei: true, digits: 3 })}
            icon={Wallet}
            loading={rent.isLoading}
          />
          <Stat
            title="Total Rent Distributed"
            value={formatEth(rent.data?.total_rent_distributed_wei ?? "0", { fromWei: true, digits: 3 })}
            icon={Coins}
            loading={rent.isLoading}
          />
          <Stat
            title="Payments Received"
            value={String(rent.data?.total_payments ?? 0)}
            icon={Receipt}
            loading={rent.isLoading}
          />
          <Stat
            title="Active Rentals"
            value={String(rent.data?.active_rentals ?? 0)}
            icon={ArrowRight}
            loading={rent.isLoading}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Properties</CardTitle>
            <CardDescription>Set monthly rent and trigger on-chain sync per property.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <PropertiesRentTable properties={properties.data ?? []} loading={properties.isLoading} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Recent Rent Payments</CardTitle>
              <CardDescription>From tenants on Sepolia.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Tenant</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i} className="hover:bg-transparent">
                        <TableCell colSpan={4}>
                          <Skeleton className="h-7 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (payments.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10">
                        <EmptyState title="No rent payments yet" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    (payments.data ?? []).slice(0, 8).map((p) => (
                      <TableRow key={p.id ?? p.tx_hash}>
                        <TableCell className="font-mono text-xs">
                          <a
                            href={txExplorerUrl(p.tx_hash)}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:underline"
                          >
                            {shortAddress(p.tenant_wallet, 6, 4)}
                          </a>
                        </TableCell>
                        <TableCell className="text-xs">
                          {p.property_name ?? `#${p.property_id}`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {Number(p.amount_eth).toFixed(4)} ETH
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(p.payment_date)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Distributions</CardTitle>
              <CardDescription>Splits broadcast to investor wallets.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Property</TableHead>
                    <TableHead className="text-right">Distributed</TableHead>
                    <TableHead className="text-right">Investors</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {distributions.isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i} className="hover:bg-transparent">
                        <TableCell colSpan={4}>
                          <Skeleton className="h-7 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (distributions.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10">
                        <EmptyState title="No distributions yet" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    (distributions.data ?? []).slice(0, 8).map((d) => (
                      <TableRow key={d.id ?? d.distribution_tx_hash}>
                        <TableCell className="text-xs">
                          {d.property_name ?? `#${d.property_id}`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {(Number(d.total_distributed) / 1e18).toFixed(4)} ETH
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {d.investor_count}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDateTime(d.distributed_at)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}

function Stat({
  title,
  value,
  icon: Icon,
  loading,
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex flex-col">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </span>
          {loading ? (
            <Skeleton className="mt-1.5 h-7 w-24" />
          ) : (
            <span className="mt-1 text-xl font-semibold tabular-nums">{value}</span>
          )}
        </div>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}

function PropertiesRentTable({
  properties,
  loading,
}: {
  properties: Property[];
  loading?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Property</TableHead>
          <TableHead className="text-right">Monthly Rent</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              <TableCell colSpan={4}>
                <Skeleton className="h-9 w-full" />
              </TableCell>
            </TableRow>
          ))
        ) : properties.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="py-10">
              <EmptyState title="No properties" />
            </TableCell>
          </TableRow>
        ) : (
          properties.map((p) => (
            <PropertyRentRow key={p.id} property={p} />
          ))
        )}
      </TableBody>
    </Table>
  );
}

function PropertyRentRow({ property }: { property: Property }) {
  const setRent = useSetRent();
  const sync = useSyncRentChain();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(property.monthly_rent_eth ? String(property.monthly_rent_eth) : "");

  const monthly = Number(property.monthly_rent_eth ?? 0);

  async function onSync() {
    try {
      const r = await sync.mutateAsync(property.id);
      toast.success(`Synced. ${r?.investor_count ?? 0} investors on-chain.`);
    } catch (e: any) {
      toast.error(e?.message || "Sync failed.");
    }
  }
  async function onSubmitRent(e: React.FormEvent) {
    e.preventDefault();
    try {
      await setRent.mutateAsync({ property_id: property.id, monthly_rent_eth: value });
      toast.success("Rent updated.");
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to set rent.");
    }
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{property.name}</span>
          <span className="text-xs text-muted-foreground">{property.location}</span>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {monthly > 0 ? `${monthly.toFixed(4)} ETH` : <span className="text-muted-foreground">Not set</span>}
      </TableCell>
      <TableCell>
        {property.token_address ? (
          <Badge variant="success">Token deployed</Badge>
        ) : (
          <Badge variant="warning">Not deployed</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1.5">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                Set Rent
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Set Monthly Rent</DialogTitle>
                <DialogDescription>{property.name}</DialogDescription>
              </DialogHeader>
              <form onSubmit={onSubmitRent} className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label>Amount (ETH)</Label>
                  <Input
                    type="number"
                    step="0.000000000000000001"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    required
                  />
                </div>
                <DialogFooter className="pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={setRent.isPending}>
                    {setRent.isPending ? "Saving…" : "Save"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={onSync}
            disabled={sync.isPending}
          >
            <RefreshCw className={cn("mr-1 h-3 w-3", sync.isPending && "animate-spin")} />
            Sync
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
