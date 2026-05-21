"use client";

import { useMemo } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CreditCard, Home, MapPin, Receipt } from "lucide-react";
import { AdminTopbar } from "@/components/layout/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTenantActiveRentals, useTenantPayments } from "@/lib/queries";
import { formatDateTime, formatEth, formatShortDate, parseBackendDate, shortAddress } from "@/lib/utils";
import { txExplorerUrl } from "@/lib/runtime-config";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";

export default function TenantPaymentsPage() {
  const wallet = useCurrentWallet();
  const payments = useTenantPayments(wallet);
  const rentals = useTenantActiveRentals(wallet);

  const chartData = useMemo(() => {
    const sorted = (payments.data ?? []).slice().sort((a, b) => (parseBackendDate(a.payment_date)?.getTime() ?? 0) - (parseBackendDate(b.payment_date)?.getTime() ?? 0));
    return sorted.map((p) => ({
      name: formatShortDate(p.payment_date),
      value: Number(p.amount_eth ?? 0),
    }));
  }, [payments.data]);

  const totalPaid = useMemo(() => (payments.data ?? []).reduce((sum, p) => sum + Number(p.amount_eth ?? 0), 0), [payments.data]);

  return (
    <>
      <AdminTopbar title="Payments" subtitle="Rent payment history, active rentals, and payment analytics" />
      <main className="flex-1 space-y-5 p-4 lg:p-6">
        {/* Payment Timeline */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Timeline</CardTitle>
            <CardDescription>Your rent payments over time.</CardDescription>
          </CardHeader>
          <CardContent>
            {payments.isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : chartData.length === 0 ? (
              <div className="grid h-[260px] place-items-center text-sm text-muted-foreground">No payments yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [`${Number(value).toFixed(4)} ETH`, "Rent Paid"]}
                  />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_0.85fr]">
          {/* Payment History */}
          <Card>
            <CardHeader>
              <CardTitle>Payment History</CardTitle>
              <CardDescription>All your rent payments on-chain.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {payments.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (payments.data ?? []).length === 0 ? (
                <div className="py-10">
                  <EmptyState title="No payments yet" description="Your rent payments will appear here after confirmation." />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Property</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(payments.data ?? []).map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="grid h-7 w-7 place-items-center rounded-md bg-chart-2/15 text-chart-2">
                              <Receipt className="h-3.5 w-3.5" />
                            </span>
                            <span className="text-sm font-medium">{payment.property_name ?? `Property #${payment.property_id}`}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(payment.payment_date)}</TableCell>
                        <TableCell>
                          <Badge variant={payment.payment_status === "completed" ? "success" : "warning"} className="rounded-md text-[10px]">
                            {payment.payment_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">{payment.amount_eth} ETH</TableCell>
                        <TableCell>
                          <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                            <a href={txExplorerUrl(payment.tx_hash)} target="_blank" rel="noreferrer">
                              <CreditCard className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Active Rentals */}
          <Card>
            <CardHeader>
              <CardTitle>Active Rentals</CardTitle>
              <CardDescription>Properties you are currently renting.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {rentals.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
              ) : (rentals.data ?? []).length === 0 ? (
                <EmptyState title="No active rentals" description="Browse properties and start renting." icon={Home} />
              ) : (
                (rentals.data ?? []).map((rental) => (
                  <div key={rental.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold">{rental.property_name ?? `Property #${rental.property_id}`}</h3>
                          <Badge variant="success" className="rounded-md text-[10px]">Active</Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" /> {rental.location ?? "—"}
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Start Date</span>
                        <div className="mt-0.5 font-medium">{rental.rental_start_date ? formatDateTime(rental.rental_start_date) : "—"}</div>
                      </div>
                      <div>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Status</span>
                        <div className="mt-0.5 font-medium capitalize">{rental.status}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
