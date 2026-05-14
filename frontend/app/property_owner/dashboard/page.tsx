"use client";

import { useEffect, useState } from "react";
import { AdminTopbar } from "@/components/layout/topbar";
import { useProperties } from "@/lib/queries";
import { PropertiesOverviewTable } from "@/components/dashboard/properties-overview-table";
import { TokenDistributionChart } from "@/components/dashboard/token-distribution-chart";
import { InvestorShareChart } from "@/components/dashboard/investor-share-chart";
import { PropertyOwnerAiCommandCenter } from "@/components/property_owner/ai/property-owner-ai-command-center";
import { AutonomousIntelFeed } from "@/components/ai/autonomous-intel-feed";
import type { Property } from "@/lib/types";

export default function DashboardPage() {
  const properties = useProperties();

  const [selected, setSelected] = useState<Property | null>(null);
  useEffect(() => {
    if (selected) return;
    if (properties.data && properties.data.length > 0) {
      setSelected(properties.data[0]);
    }
  }, [properties.data, selected]);

  return (
    <>
      <AdminTopbar
        title="Admin Dashboard"
        subtitle="Real-time overview of properties, token distribution & investor participation"
      />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <PropertyOwnerAiCommandCenter />
        <AutonomousIntelFeed />

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
