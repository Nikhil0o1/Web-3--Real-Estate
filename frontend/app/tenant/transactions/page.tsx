"use client";

import { AdminTopbar } from "@/components/layout/topbar";
import { TransactionsTable } from "@/components/transactions/transactions-table";
import { useTenantTransactions } from "@/lib/queries";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";

export default function TenantTransactionsPage() {
  const wallet = useCurrentWallet();
  const transactions = useTenantTransactions(wallet);
  return (
    <>
      <AdminTopbar title="Transactions" subtitle="Your wallet-scoped rent payments and on-chain activity" />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <TransactionsTable transactions={transactions.data ?? []} loading={transactions.isLoading} />
      </main>
    </>
  );
}
