"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Building2, CreditCard, History, LayoutDashboard, Receipt } from "lucide-react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCurrency, formatEth } from "@/lib/utils";
import { useTenantPayments, useTenantProperties } from "@/lib/queries";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";

const NAV = [
  { href: "/tenant", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tenant/rentals", label: "Rentals", icon: Building2 },
  { href: "/tenant/payments", label: "Payments", icon: Receipt },
  { href: "/tenant/transactions", label: "Transactions", icon: History },
] as const;

export function TenantSidebar() {
  const pathname = usePathname();
  const wallet = useCurrentWallet();
  const properties = useTenantProperties();
  const payments = useTenantPayments(wallet);

  const totalPaid = (payments.data ?? []).reduce((sum, p) => sum + Number(p.amount_eth ?? 0), 0);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card/40 px-4 py-5 lg:flex">
      <Link href="/tenant" className="mb-6 flex items-center gap-2.5 px-1">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-chart-2 font-bold text-primary-foreground">
          E
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">EstateChain</span>
          <span className="text-[11px] text-muted-foreground">Tenant Portal</span>
        </div>
      </Link>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.href === "/tenant" ? pathname === "/tenant" : pathname?.startsWith(item.href);
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
                  layoutId="tenant-sidebar-active"
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
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total Rent Paid</div>
          {payments.isLoading ? (
            <Skeleton className="mt-2 h-7 w-24" />
          ) : (
            <div className="mt-1.5 text-xl font-semibold tracking-tight">{formatEth(String(totalPaid), { digits: 4 })} ETH</div>
          )}
          <div className="mt-1 text-[11px] text-muted-foreground">{payments.data?.length ?? 0} payments</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Properties Available</div>
          {properties.isLoading ? (
            <Skeleton className="mt-2 h-7 w-16" />
          ) : (
            <div className="mt-1.5 text-xl font-semibold tracking-tight">{properties.data?.length ?? 0}</div>
          )}
        </div>
      </div>
    </aside>
  );
}
