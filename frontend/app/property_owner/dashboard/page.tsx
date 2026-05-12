"use client";

import { useEffect, useState } from "react";
import { AdminTopbar } from "@/components/layout/topbar";
import { useDashboardSummary, useProperties, useRentAnalytics, useTransactions, useUsers } from "@/lib/queries";
import { PropertiesOverviewTable } from "@/components/dashboard/properties-overview-table";
import { TokenDistributionChart } from "@/components/dashboard/token-distribution-chart";
import { InvestorShareChart } from "@/components/dashboard/investor-share-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Receipt, Users, Coins, Building2 } from "lucide-react";
import { formatEth, formatNumber } from "@/lib/utils";
import type { Property } from "@/lib/types";

export default function DashboardPage() {
  const properties = useProperties();
  const transactions = useTransactions();
  const users = useUsers();
  const summary = useDashboardSummary();
  const rent = useRentAnalytics();

  const [selected, setSelected] = useState<Property | null>(null);
  useEffect(() => {
    if (selected) return;
    if (properties.data && properties.data.length > 0) {
      setSelected(properties.data[0]);
    }
  }, [properties.data, selected]);

  const stats = [
    {
      title: "Properties",
      value: formatNumber(summary.data?.properties_loaded ?? properties.data?.length ?? 0),
      icon: Building2,
      loading: summary.isLoading,
    },
    {
      title: "Investors",
      value: formatNumber(users.data?.length ?? 0),
      icon: Users,
      loading: users.isLoading,
    },
    {
      title: "Transactions",
      value: formatNumber(transactions.data?.length ?? 0),
      icon: Receipt,
      loading: transactions.isLoading,
    },
    {
      title: "Rent Distributed",
      value: formatEth(rent.data?.total_rent_distributed_wei ?? "0", { fromWei: true, digits: 3 }),
      icon: Coins,
      loading: rent.isLoading,
    },
  ];

  return (
    <>
      <AdminTopbar
        title="Admin Dashboard"
        subtitle="Real-time overview of properties, token distribution & investor participation"
      />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.title} className="overflow-hidden">
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {s.title}
                  </span>
                  {s.loading ? (
                    <Skeleton className="mt-1.5 h-6 w-20" />
                  ) : (
                    <span className="mt-1 text-xl font-semibold tabular-nums">{s.value}</span>
                  )}
                </div>
                <div className="grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
                  <s.icon className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <PropertiesOverviewTable
          properties={properties.data ?? []}
          loading={properties.isLoading}
          selectedId={selected?.id ?? null}
          onSelectProperty={(p) => setSelected(p)}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TokenDistributionChart
            properties={properties.data ?? []}
            loading={properties.isLoading}
            selectedId={selected?.id ?? null}
            onSelect={(p) => setSelected(p)}
          />
          <InvestorShareChart property={selected} />
        </div>
      </main>
    </>
  );
}
