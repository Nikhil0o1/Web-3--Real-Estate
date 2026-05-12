"use client";

import { AdminTopbar } from "@/components/layout/topbar";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { useTransactions } from "@/lib/queries";

export default function TransactionsPage() {
  const { data, isLoading } = useTransactions();
  return (
    <>
      <AdminTopbar
        title="Transactions"
        subtitle="Full transaction ledger indexed from Sepolia — click a row for details"
      />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <TransactionsTable transactions={data ?? []} loading={isLoading} />
      </main>
    </>
  );
}
