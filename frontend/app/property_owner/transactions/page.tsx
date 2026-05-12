"use client";

import { AdminTopbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { useTransactions } from "@/lib/queries";

export default function TransactionsPage() {
  const { data, isLoading } = useTransactions();
  return (
    <>
      <AdminTopbar title="Transactions" subtitle="On-chain activity indexed from Sepolia" />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <PageHeader title="Transactions" description="Browse every transaction recorded by the indexer." />
        <TransactionsTable transactions={data ?? []} loading={isLoading} />
      </main>
    </>
  );
}
