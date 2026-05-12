"use client";

import { AdminTopbar } from "@/components/layout/topbar";
import { InvestorsTable } from "@/components/investors/investors-table";
import { useProperties, useUsers } from "@/lib/queries";

export default function InvestorsPage() {
  const users = useUsers();
  const properties = useProperties();
  return (
    <>
      <AdminTopbar
        title="Investors"
        subtitle="Wallets with fractional positions — aggregated from on-chain ownership"
      />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <InvestorsTable
          users={users.data ?? []}
          properties={properties.data ?? []}
          loading={users.isLoading || properties.isLoading}
        />
      </main>
    </>
  );
}
