"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowUpRight, Building2, Coins, LineChart, Receipt, Wallet } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { motion } from "framer-motion";
import { AdminTopbar } from "@/components/layout/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useClaimableRewards,
  useInvestorPayouts,
  useInvestorTransactions,
  useInvestorYieldSummary,
  usePortfolio,
  useProperties,
  useWalletBalances,
} from "@/lib/queries";
import { cn, formatCurrency, formatDateTime, formatEth, formatNumber, shortAddress } from "@/lib/utils";
import { txExplorerUrl } from "@/lib/runtime-config";
import { buildInvestorMetrics, humanTokenAmount, ownershipPercent } from "@/components/investor/investor-utils";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";
import { AiCommandCenter } from "@/components/investor/ai/ai-command-center";
import { AiActivityFeed } from "@/components/investor/ai/ai-activity-feed";
import { AiInsightCards } from "@/components/investor/ai/ai-insight-cards";
import { AiPortfolioNarrative } from "@/components/investor/ai/ai-portfolio-narrative";
import { AutonomousIntelFeed } from "@/components/ai/autonomous-intel-feed";

export default function InvestorDashboardPage() {
  const wallet = useCurrentWallet();
  const properties = useProperties();
  const portfolio = usePortfolio(wallet);
  const balances = useWalletBalances(wallet);
  const yieldSummary = useInvestorYieldSummary(wallet);
  const claimable = useClaimableRewards(wallet);
  const payouts = useInvestorPayouts(wallet);
  const transactions = useInvestorTransactions(wallet);

  const propertyMap = useMemo(
    () => new Map((properties.data ?? []).map((p) => [Number(p.id), p])),
    [properties.data],
  );
  const metrics = useMemo(
    () => buildInvestorMetrics(portfolio.data?.holdings ?? [], properties.data ?? []),
    [portfolio.data?.holdings, properties.data],
  );
  const timeline = useMemo(
    () =>
      (payouts.data ?? [])
        .slice()
        .sort((a, b) => new Date(a.distributed_at).getTime() - new Date(b.distributed_at).getTime())
        .slice(-10)
        .map((p) => ({
          name: new Date(p.distributed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          value: Number(p.payout_amount_eth ?? 0),
        })),
    [payouts.data],
  );

  const loading = properties.isLoading || portfolio.isLoading;
  const holdings = portfolio.data?.holdings ?? [];
  const nextClaim = claimable.data?.properties?.[0];

  return (
    <>
      <AdminTopbar
        title="Investor Dashboard"
        subtitle="Your holdings, yield, wallet health, and latest on-chain activity"
      />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard title="Portfolio Value" value={formatCurrency(metrics.estimatedValue)} icon={Wallet} loading={loading} sub={`${metrics.propertiesOwned} properties`} />
          <MetricCard title="Tokens Held" value={formatNumber(metrics.totalTokens, 4)} icon={Building2} loading={loading} sub={`${holdings.length} active positions`} />
          <MetricCard title="Claimable Yield" value={`${claimable.data?.total_claimable_eth ?? "0"} ETH`} icon={Coins} loading={claimable.isLoading} sub={`${claimable.data?.properties?.length ?? 0} properties accruing`} accent="success" />
          <MetricCard title="Wallet Balance" value={formatEth(balances.data?.native?.balance ?? "0", { digits: 4 })} icon={LineChart} loading={balances.isLoading} sub={shortAddress(wallet, 6, 4)} />
        </section>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24 }}
          className="space-y-4"
        >
          <AiInsightCards portfolio={portfolio.data} properties={properties.data} claimable={claimable.data} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <AiPortfolioNarrative portfolio={portfolio.data} claimable={claimable.data} />
            <div className="flex flex-col gap-4">
              <AiActivityFeed />
              <AutonomousIntelFeed />
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.26, delay: 0.04 }}
        >
          <AiCommandCenter />
        </motion.section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Portfolio at a Glance</CardTitle>
                <CardDescription>Estimated ownership value from indexed token balances.</CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/investor/portfolio">Open Portfolio <ArrowUpRight className="h-3.5 w-3.5" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
              ) : holdings.length === 0 ? (
                <div className="grid min-h-[210px] place-items-center rounded-lg border border-dashed border-border text-center">
                  <div className="max-w-sm px-6">
                    <div className="text-sm font-medium">No holdings yet</div>
                    <p className="mt-1 text-xs text-muted-foreground">Browse the marketplace and purchase property tokens to start earning rental yield.</p>
                    <Button asChild size="sm" className="mt-4">
                      <Link href="/investor/marketplace">Explore Marketplace</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                holdings.slice(0, 4).map((holding) => {
                  const property = propertyMap.get(Number(holding.property_id));
                  const pct = ownershipPercent(holding, property);
                  return (
                    <div key={holding.property_id} className="rounded-lg border border-border bg-muted/20 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{holding.property_name}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{property?.location ?? `Property #${holding.property_id}`}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold">{humanTokenAmount(holding.token_amount)} {property?.token_symbol ?? "TOKENS"}</div>
                          <div className="text-xs text-muted-foreground">{pct.toFixed(3)}% ownership</div>
                        </div>
                      </div>
                      <Progress value={Math.min(pct, 100)} className="mt-3 h-1.5" />
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden">
            <div className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
            <CardHeader>
              <CardTitle>Yield Center</CardTitle>
              <CardDescription>Claimable rental rewards from the RentDistribution contract.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-3xl font-semibold tracking-tight">{claimable.data?.total_claimable_eth ?? "0"} ETH</div>
                <div className="mt-1 text-xs text-muted-foreground">Total claimed: {claimable.data?.total_claimed_eth ?? yieldSummary.data?.total_claimed_eth ?? "0"} ETH</div>
              </div>
              {nextClaim ? (
                <div className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{nextClaim.property_name ?? `Property #${nextClaim.property_id}`}</div>
                      <div className="text-xs text-muted-foreground">{nextClaim.pending_payouts} pending accruals</div>
                    </div>
                    <Badge variant="success">{nextClaim.claimable_amount_eth} ETH</Badge>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No claimable rewards yet.</div>
              )}
              <Button asChild className="w-full">
                <Link href="/investor/yield">Review Yield & Claims</Link>
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Yield Timeline</CardTitle>
              <CardDescription>Recent rental accruals credited to your wallet.</CardDescription>
            </CardHeader>
            <CardContent>
              {payouts.isLoading ? (
                <Skeleton className="h-[210px] w-full" />
              ) : timeline.length === 0 ? (
                <div className="grid h-[210px] place-items-center text-sm text-muted-foreground">No rental accruals yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <AreaChart data={timeline} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="investorYield" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(value: number) => [`${Number(value).toFixed(6)} ETH`, "Accrued"]}
                    />
                    <Area dataKey="value" type="monotone" stroke="hsl(var(--primary))" fill="url(#investorYield)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Your latest indexed Sepolia transactions.</CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href="/investor/transactions">View All</Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {transactions.isLoading ? (
                Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
              ) : (transactions.data ?? []).length === 0 ? (
                <div className="grid h-[210px] place-items-center text-sm text-muted-foreground">No activity yet.</div>
              ) : (
                (transactions.data ?? []).slice(0, 5).map((tx) => (
                  <a key={tx.tx_hash} href={txExplorerUrl(tx.tx_hash)} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2 transition-colors hover:bg-muted">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{tx.action_label}</div>
                      <div className="text-xs text-muted-foreground">{tx.property_name ?? "Platform"} · {formatDateTime(tx.timestamp)}</div>
                    </div>
                    <div className={cn("text-right text-xs font-medium", tx.type === "REWARDS_CLAIMED" ? "text-success" : "text-foreground")}>{tx.display_amount} {tx.amount_unit}</div>
                  </a>
                ))
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </>
  );
}

function MetricCard({
  title,
  value,
  sub,
  icon: Icon,
  loading,
  accent,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
  accent?: "success";
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
          {loading ? <Skeleton className="mt-2 h-7 w-24" /> : <div className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</div>}
          {sub && !loading ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div> : null}
        </div>
        <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary", accent === "success" && "bg-success/10 text-success")}>
          <Icon className="h-4 w-4" />
        </div>
      </CardContent>
    </Card>
  );
}
