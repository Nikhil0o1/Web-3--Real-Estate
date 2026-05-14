"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  Coins,
  LayoutDashboard,
  Receipt,
  Shield,
  Users,
  Wallet,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn, formatCurrency, formatEth } from "@/lib/utils";
import { useDashboardSummary, useRentAnalytics } from "@/lib/queries";
import { Skeleton } from "@/components/ui/skeleton";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const NAV: NavItem[] = [
  { href: "/property_owner/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/property_owner/properties", label: "Properties", icon: Building2 },
  { href: "/property_owner/transactions", label: "Transactions", icon: Receipt },
  { href: "/property_owner/investors", label: "Investors", icon: Users },
  { href: "/property_owner/rent", label: "Rent Management", icon: Coins },
  { href: "/property_owner/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/property_owner/governance", label: "AI Governance", icon: Shield },
];

function MetricCard({
  title,
  value,
  delta,
  loading,
  icon: Icon,
  accent = "primary",
}: {
  title: string;
  value: string;
  delta?: string;
  loading?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  accent?: "primary" | "violet";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card p-3.5",
        "shadow-[inset_0_1px_0_hsl(var(--border)/0.6)]",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <Icon className={cn("h-3.5 w-3.5", accent === "primary" ? "text-primary" : "text-chart-3")} />
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <div className={cn("mt-1.5 text-xl font-semibold tracking-tight", accent === "primary" ? "text-primary" : "text-chart-3")}>
          {value}
        </div>
      )}
      {delta && !loading ? <div className="mt-1 text-[11px] text-muted-foreground">{delta}</div> : null}
    </div>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const summary = useDashboardSummary();
  const rent = useRentAnalytics();

  const TOKEN_DECIMALS = 18;
  const divisor = Math.pow(10, TOKEN_DECIMALS);
  const totalPortfolio = Number(summary.data?.total_portfolio_value ?? 0) / divisor;

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card/40 px-4 py-5 lg:flex">
      <Link href="/property_owner/dashboard" className="mb-6 flex items-center gap-2.5 px-1">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-chart-2 font-bold text-primary-foreground">
          E
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">EstateChain</span>
          <span className="text-[11px] text-muted-foreground">Admin Panel</span>
        </div>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
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
        <MetricCard
          title="Total Portfolio Value"
          value={formatCurrency(totalPortfolio)}
          delta={`${summary.data?.properties_loaded ?? 0} properties indexed`}
          loading={summary.isLoading}
          icon={Wallet}
          accent="primary"
        />
        <MetricCard
          title="Total Rent Collected"
          value={formatEth(rent.data?.total_rent_collected_wei ?? "0", { fromWei: true, digits: 4 })}
          delta={`${rent.data?.total_payments ?? 0} payments`}
          loading={rent.isLoading}
          icon={Coins}
          accent="violet"
        />
      </div>
    </aside>
  );
}
