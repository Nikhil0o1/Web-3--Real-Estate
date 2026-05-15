"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Building2, Calendar, CreditCard, Home, MapPin, Receipt, Wallet } from "lucide-react";
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
import { useTenantActiveRentals, useTenantPayments, useTenantProperties, useWalletBalances } from "@/lib/queries";
import { cn, formatDateTime, formatEth, shortAddress } from "@/lib/utils";
import { txExplorerUrl } from "@/lib/runtime-config";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";
import { TenantAiCommandCenter } from "@/components/tenant/ai/tenant-ai-command-center";
import { AutonomousIntelFeed } from "@/components/ai/autonomous-intel-feed";
import { DashboardAiCopilotDock } from "@/components/ai/dashboard-ai-copilot-dock";

export default function TenantDashboardPage() {
  const wallet = useCurrentWallet();
  const properties = useTenantProperties(wallet);
  const payments = useTenantPayments(wallet);
  const rentals = useTenantActiveRentals(wallet);
  const balances = useWalletBalances(wallet);

  const rentEnabledProperties = useMemo(
    () => (properties.data ?? []).filter((p) => p.rent_enabled),
    [properties.data],
  );

  return (
    <>
      <AdminTopbar title="Tenant Dashboard" subtitle="Manage rentals, pay rent, and track your payment history" />
      <main className="flex-1 space-y-5 p-4 lg:p-6">
        {/* Wallet Overview */}
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium">{shortAddress(wallet, 8, 6)}</div>
                <div className="text-xs text-muted-foreground">
                  {balances.isLoading ? "Loading…" : `${formatEth(balances.data?.native?.balance ?? "0", { digits: 4 })} ETH available`}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <Home className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{rentals.data?.length ?? 0}</span>
                <span className="text-muted-foreground">active rentals</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{payments.data?.length ?? 0}</span>
                <span className="text-muted-foreground">payments</span>
              </div>
              <Button asChild size="sm">
                <Link href="/tenant/rentals">Pay Rent <ArrowRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </div>
          </div>
        </Card>

        <DashboardAiCopilotDock
          eyebrow="Tenant AI"
          title="AI Copilot"
          description="Payment reminders, affordability checks, and rental summaries stay tucked into this dock."
        >
          <TenantAiCommandCenter />
          <AutonomousIntelFeed />
        </DashboardAiCopilotDock>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          {/* Active Rentals */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>Active Rentals</CardTitle>
                <CardDescription>Properties you are currently renting.</CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/tenant/rentals">View All</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {rentals.isLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : (rentals.data ?? []).length === 0 ? (
                <EmptyState title="No active rentals" description="Browse available properties and start renting." icon={Building2} />
              ) : (
                <div className="space-y-3">
                  {(rentals.data ?? []).slice(0, 4).map((rental) => (
                    <div key={rental.id} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex items-center gap-3">
                        <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
                          <Home className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-sm font-medium">{rental.property_name ?? `Property #${rental.property_id}`}</div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" /> {rental.location ?? "—"}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant="success" className="rounded-md text-[10px]">Active</Badge>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {rental.rental_start_date ? `Since ${formatDateTime(rental.rental_start_date)}` : "—"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Rent Status */}
          <Card>
            <CardHeader>
              <CardTitle>Rent Status</CardTitle>
              <CardDescription>Overview of rent-ready properties.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                {properties.isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
                ) : rentEnabledProperties.length === 0 ? (
                  <EmptyState title="No rent-ready properties" description="Properties will appear when rent is set by the owner." />
                ) : (
                  rentEnabledProperties.slice(0, 5).map((property) => {
                    const hasActiveRental = (rentals.data ?? []).some((r) => r.property_id === property.id);
                    return (
                      <div key={property.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{property.name}</div>
                          <div className="text-xs text-muted-foreground">{property.monthly_rent_eth} ETH / month</div>
                        </div>
                        <Badge variant={hasActiveRental ? "success" : "outline"} className="shrink-0 rounded-md text-[10px]">
                          {hasActiveRental ? "Renting" : "Available"}
                        </Badge>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Payments */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>Recent Payments</CardTitle>
              <CardDescription>Your latest rent payments on Sepolia.</CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/tenant/payments">View All</Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {payments.isLoading ? (
              <Skeleton className="h-48 w-full" />
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
                  {(payments.data ?? []).slice(0, 6).map((payment) => (
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
      </main>
    </>
  );
}
