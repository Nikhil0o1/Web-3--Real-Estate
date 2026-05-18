"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { CheckCircle2, Coins, Gift, History, ShieldCheck, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, useClaimableRewards, useClaimHistory, useInvestorDistributions, useInvestorPayouts, useInvestorYieldSummary } from "@/lib/queries";
import { txExplorerUrl } from "@/lib/runtime-config";
import type { ClaimRewardsConfirmResponse, ClaimRewardsPrepareResponse, ClaimableRewardProperty } from "@/lib/types";
import { AdminTopbar } from "@/components/layout/topbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty";
import { cn, formatDateTime, shortAddress } from "@/lib/utils";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";
import { sendClaimRewardsTx } from "@/components/investor/contract-actions";
import { isWorkflowModalAction, subscribeWorkflowAction, workflowPropertyMatches } from "@/lib/ai/action-executor";

export default function InvestorYieldPage() {
  const wallet = useCurrentWallet();
  const summary = useInvestorYieldSummary(wallet);
  const claimable = useClaimableRewards(wallet);
  const history = useClaimHistory(wallet);
  const payouts = useInvestorPayouts(wallet);
  const distributions = useInvestorDistributions(wallet);
  const [selected, setSelected] = useState<ClaimableRewardProperty | null>(null);

  const timeline = useMemo(() => (payouts.data ?? []).slice().sort((a, b) => new Date(a.distributed_at).getTime() - new Date(b.distributed_at).getTime()).map((p) => ({
    name: new Date(p.distributed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value: Number(p.payout_amount_eth ?? 0),
  })), [payouts.data]);

  useEffect(() => {
    return subscribeWorkflowAction((action) => {
      if (!isWorkflowModalAction(action, "CLAIM_REWARDS")) return;
      if (action.type !== "OPEN_MODAL") return;
      const rewards = claimable.data?.properties ?? [];
      const match = rewards.find((reward) => workflowPropertyMatches(action, reward.property_id));
      if (match) setSelected(match);
    });
  }, [claimable.data?.properties]);

  return (
    <>
      <AdminTopbar title="Yield & Claims" subtitle="Track accrued rental yield and claim ETH directly from the RentDistribution contract" />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat title="Total Earned" value={`${summary.data?.total_earned_eth ?? "0"} ETH`} icon={Coins} loading={summary.isLoading} />
          <Stat title="Claimable" value={`${claimable.data?.total_claimable_eth ?? "0"} ETH`} icon={Gift} loading={claimable.isLoading} accent />
          <Stat title="Total Claimed" value={`${claimable.data?.total_claimed_eth ?? summary.data?.total_claimed_eth ?? "0"} ETH`} icon={CheckCircle2} loading={claimable.isLoading || summary.isLoading} />
          <Stat title="Payout Records" value={String(summary.data?.total_payouts ?? 0)} icon={History} loading={summary.isLoading} />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <CardTitle>Claimable Rewards</CardTitle>
              <CardDescription>Each claim opens MetaMask and withdraws ETH from the rent contract.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {claimable.isLoading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
              ) : (claimable.data?.properties ?? []).length === 0 ? (
                <EmptyState title="No claimable rewards" description="When tenants pay rent, your rewards will accrue here." />
              ) : (
                (claimable.data?.properties ?? []).map((reward) => (
                  <div key={reward.property_id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-semibold">{reward.property_name ?? `Property #${reward.property_id}`}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{reward.pending_payouts} pending payout records{reward.last_distributed_at ? ` · last accrued ${formatDateTime(reward.last_distributed_at)}` : ""}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="success" className="rounded-md">{reward.claimable_amount_eth} ETH</Badge>
                        <Button size="sm" onClick={() => setSelected(reward)}>Claim</Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Yield Timeline</CardTitle>
              <CardDescription>Accruals credited to your wallet.</CardDescription>
            </CardHeader>
            <CardContent>
              {payouts.isLoading ? (
                <Skeleton className="h-[270px] w-full" />
              ) : timeline.length === 0 ? (
                <div className="grid h-[270px] place-items-center text-sm text-muted-foreground">No accruals yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height={270}>
                  <AreaChart data={timeline} margin={{ top: 16, right: 8, left: -18, bottom: 0 }}>
                    <defs><linearGradient id="yieldClaims" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs>
                    <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`${Number(v).toFixed(6)} ETH`, "Accrued"]} />
                    <Area dataKey="value" type="monotone" stroke="hsl(var(--primary))" fill="url(#yieldClaims)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Earnings by Property</CardTitle>
              <CardDescription>Aggregated rental accruals per property.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {distributions.isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />) : (distributions.data ?? []).length === 0 ? <EmptyState title="No earnings yet" /> : (distributions.data ?? []).map((row) => (
                <div key={row.property_id} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <div><div className="text-sm font-medium">{row.property_name ?? `Property #${row.property_id}`}</div><div className="text-xs text-muted-foreground">{row.payment_count} payments · {row.current_ownership}% ownership</div></div>
                  <div className="text-sm font-semibold tabular-nums">{row.total_earned_eth} ETH</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Claim History</CardTitle>
              <CardDescription>Completed withdrawal transactions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {history.isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />) : (history.data ?? []).length === 0 ? <EmptyState title="No claims yet" /> : (history.data ?? []).map((claim) => (
                <a key={claim.claim_tx_hash} href={txExplorerUrl(claim.claim_tx_hash)} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2 transition-colors hover:bg-muted">
                  <div><div className="text-sm font-medium">{claim.property_name ?? `Property #${claim.property_id}`}</div><div className="text-xs text-muted-foreground">{claim.payout_count} payout rows · {formatDateTime(claim.claimed_at)} · {shortAddress(claim.claim_tx_hash, 7, 5)}</div></div>
                  <div className="text-sm font-semibold tabular-nums text-success">{claim.claimed_amount_eth} ETH</div>
                </a>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>
      <ClaimDialog wallet={wallet} reward={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ClaimDialog({ wallet, reward, onClose }: { wallet: string | null; reward: ClaimableRewardProperty | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"idle" | "prepare" | "wallet" | "confirm">("idle");
  const [busy, setBusy] = useState(false);
  const open = Boolean(reward);

  const onClaim = useCallback(async () => {
    if (!wallet || !reward) return;
    setBusy(true);
    try {
      setStep("prepare");
      const prepared = await api.post<ClaimRewardsPrepareResponse>("/rewards/prepare-claim", { property_id: reward.property_id, investor_wallet: wallet });
      setStep("wallet");
      const tx = await sendClaimRewardsTx({ rentContractAddress: prepared.rent_contract_address, propertyId: reward.property_id });
      await tx.wait();
      setStep("confirm");
      const result = await api.post<ClaimRewardsConfirmResponse>("/rewards/confirm-claim", { property_id: reward.property_id, investor_wallet: wallet, tx_hash: tx.hash });
      toast.success(`Claimed ${result.claimed_amount_eth} ETH.`);
      queryClient.invalidateQueries({ queryKey: ["investor"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions });
      onClose();
      setStep("idle");
    } catch (err: any) {
      toast.error(err?.message || "Claim failed.");
    } finally {
      setBusy(false);
    }
  }, [onClose, queryClient, reward, wallet]);

  useEffect(() => {
    return subscribeWorkflowAction((action) => {
      if (!isWorkflowModalAction(action, "CLAIM_REWARDS")) return;
      if (action.type === "SUBMIT_FORM" && open) {
        window.setTimeout(() => void onClaim(), 120);
      }
    });
  }, [onClaim, open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && !next && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Claim rental yield</DialogTitle>
          <DialogDescription>{reward?.property_name ?? "Property reward"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Claimable amount</div>
            <div className="mt-1 text-2xl font-semibold">{reward?.claimable_amount_eth ?? "0"} ETH</div>
            <div className="mt-1 text-xs text-muted-foreground">Wallet {shortAddress(wallet, 6, 4)}</div>
          </div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <Step active={step === "prepare"} done={["wallet", "confirm"].includes(step)} icon={ShieldCheck} label="Preparing claim transaction" />
            <Step active={step === "wallet"} done={step === "confirm"} icon={Wallet} label="Confirming withdrawal in MetaMask" />
            <Step active={step === "confirm"} done={false} icon={CheckCircle2} label="Confirming and indexing claim" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={onClaim} disabled={busy || !wallet}>{busy ? "Processing…" : "Claim via MetaMask"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ title, value, icon: Icon, loading, accent }: { title: string; value: string; icon: React.ComponentType<{ className?: string }>; loading?: boolean; accent?: boolean }) {
  return <Card><CardContent className="flex items-start justify-between gap-3 p-4"><div><div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{title}</div>{loading ? <Skeleton className="mt-2 h-7 w-24" /> : <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>}</div><div className={cn("grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary", accent && "bg-success/10 text-success")}><Icon className="h-4 w-4" /></div></CardContent></Card>;
}

function Step({ active, done, icon: Icon, label }: { active: boolean; done: boolean; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return <div className={cn("flex items-center gap-2 rounded-md border border-border px-2.5 py-2", active && "border-primary/40 bg-primary/5 text-primary", done && "border-success/40 bg-success/5 text-success")}><Icon className="h-3.5 w-3.5" /> {label}</div>;
}
