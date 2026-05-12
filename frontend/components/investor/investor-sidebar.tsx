"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, Coins, LayoutDashboard, Receipt, Wallet } from "lucide-react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import { useClaimableRewards, usePortfolio, useProperties } from "@/lib/queries";
import { useCurrentWallet } from "./use-current-wallet";
import { buildInvestorMetrics } from "./investor-utils";

const NAV = [
  { href: "/investor", label: "Dashboard", icon: LayoutDashboard },
  { href: "/investor/marketplace", label: "Marketplace", icon: Building2 },
  { href: "/investor/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/investor/yield", label: "Yield & Claims", icon: Coins },
  { href: "/investor/transactions", label: "Transactions", icon: Receipt },
] as const;

export function InvestorSidebar() {
  const pathname = usePathname();
  const wallet = useCurrentWallet();
  const properties = useProperties();
  const portfolio = usePortfolio(wallet);
  const claimable = useClaimableRewards(wallet);
  const metrics = buildInvestorMetrics(portfolio.data?.holdings ?? [], properties.data ?? []);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card/40 px-4 py-5 lg:flex">
      <Link href="/investor" className="mb-6 flex items-center gap-2.5 px-1">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-chart-2 font-bold text-primary-foreground">
          E
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">EstateChain</span>
          <span className="text-[11px] text-muted-foreground">Investor Suite</span>
        </div>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.href === "/investor" ? pathname === "/investor" : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="investor-sidebar-active"
                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <Icon className="h-4 w-4" />
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <SidebarMetric
          title="Portfolio Value"
          value={formatCurrency(metrics.estimatedValue)}
          sub={`${metrics.propertiesOwned} properties held`}
          loading={properties.isLoading || portfolio.isLoading}
        />
        <SidebarMetric
          title="Claimable Yield"
          value={`${claimable.data?.total_claimable_eth ?? "0"} ETH`}
          sub={`${claimable.data?.properties?.length ?? 0} properties accruing`}
          loading={claimable.isLoading}
          accent="violet"
        />
      </div>
    </aside>
  );
}

function SidebarMetric({
  title,
  value,
  sub,
  loading,
  accent,
}: {
  title: string;
  value: string;
  sub: string;
  loading?: boolean;
  accent?: "violet";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-[inset_0_1px_0_hsl(var(--border)/0.6)]">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <div className={cn("mt-1.5 text-xl font-semibold tracking-tight", accent ? "text-chart-3" : "text-primary")}>{value}</div>
      )}
      {!loading ? <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
