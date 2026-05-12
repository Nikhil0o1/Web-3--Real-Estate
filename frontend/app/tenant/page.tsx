"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { WalletPill } from "@/components/layout/wallet-pill";

export default function TenantPlaceholder() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b border-border px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-chart-2 font-bold text-primary-foreground">
            E
          </div>
          <span className="text-base font-semibold">EstateChain</span>
        </Link>
        <div className="flex items-center gap-3">
          <WalletPill />
          <ThemeToggle />
        </div>
      </header>
      <main className="grid flex-1 place-items-center px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md text-center"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] uppercase tracking-wider text-muted-foreground">
            Tenant experience — coming next
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            The tenant rent flow is being redesigned.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pay rent, see receipts, and manage active leases — all wired to the same backend you already run.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/">Back to home</Link>
            </Button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
