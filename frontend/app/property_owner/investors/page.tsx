"use client";

import { AdminTopbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { InvestorsTable } from "@/components/investors/investors-table";
import { useProperties, useUsers } from "@/lib/queries";

export default function InvestorsPage() {
  const users = useUsers();
  const properties = useProperties();
  return (
    <>
      <AdminTopbar title="Investors" subtitle="Wallets that hold tokens across your properties" />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <PageHeader title="Investors" description="Aggregated holdings derived from on-chain ownership." />
        <InvestorsTable
          users={users.data ?? []}
          properties={properties.data ?? []}
          loading={users.isLoading || properties.isLoading}
        />
      </main>
    </>
  );
}
