"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, CheckCircle2, Coins, MapPin, Search, ShieldCheck, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { queryKeys, useProperties } from "@/lib/queries";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty";
import { cn, formatCurrency, formatNumber, percent, shortAddress } from "@/lib/utils";
import { PropertyImageCarousel } from "@/components/properties/property-image-carousel";
import type { InvestmentPrepareResponse, Property } from "@/lib/types";
import { availablePropertyTokens, investmentCostWei, propertyIsInvestable } from "@/components/investor/investor-utils";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";
import { sendInvestmentTx } from "@/components/investor/contract-actions";
import {
  emitWorkflowCompletion,
  focusWorkflowField,
  isWorkflowModalAction,
  preventCloseFromWorkflowBubble,
  subscribeWorkflowAction,
  takePendingModalOpen,
  workflowPropertyMatches,
} from "@/lib/ai/action-executor";

export default function InvestorMarketplacePage() {
  const wallet = useCurrentWallet();
  const properties = useProperties();
  const [search, setSearch] = useState("");
  const investable = useMemo(
    () =>
      (properties.data ?? []).filter((p) => {
        const q = search.trim().toLowerCase();
        const matches = !q || p.name.toLowerCase().includes(q) || (p.location || "").toLowerCase().includes(q);
        return matches;
      }),
    [properties.data, search],
  );

  return (
    <>
      <AdminTopbar title="Marketplace" subtitle="Browse tokenized properties and invest with MetaMask" />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-sm font-medium">Available opportunities</h2>
            <p className="text-xs text-muted-foreground">Primary sales are executed directly against each property SecurityToken contract.</p>
          </div>
          <div className="relative w-full md:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search properties…" className="h-9 pl-8 text-sm" />
          </div>
        </div>

        {properties.isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[360px] rounded-xl" />)}
          </div>
        ) : investable.length === 0 ? (
          <EmptyState title="No properties found" description="Try a different search term or wait for new listings." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {investable.map((property) => <MarketplaceCard key={property.id} property={property} wallet={wallet} />)}
          </div>
        )}
      </main>
    </>
  );
}

function MarketplaceCard({ property, wallet }: { property: Property; wallet: string | null }) {
  const sold = Number(property.tokens_sold ?? 0);
  const supply = Number(property.token_supply ?? 0);
  const soldPct = Number(property.sold_percentage ?? percent(sold, supply));
  const tokenPrice = Number(property.token_sale_price_eth ?? 0);
  const monthlyRent = Number(property.monthly_rent_eth ?? 0);
  const investable = propertyIsInvestable(property);
  const available = availablePropertyTokens(property);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (takePendingModalOpen("INVEST_PROPERTY", property.id)) {
      setOpen(true);
    }
    return subscribeWorkflowAction((action) => {
      if (!isWorkflowModalAction(action, "INVEST_PROPERTY")) return;
      if (action.type === "OPEN_MODAL" && workflowPropertyMatches(action, property.id)) {
        setOpen(true);
      }
    });
  }, [property.id]);

  return (
    <Card className="group overflow-hidden transition-transform duration-200 hover:-translate-y-0.5">
      <PropertyImageCarousel images={property.images} propertyId={property.id} title={property.name}>
        <div className="absolute left-3 top-3 flex gap-2">
          <Badge variant={investable ? "success" : "warning"}>{investable ? "Investable" : "Not ready"}</Badge>
          {monthlyRent > 0 ? <Badge variant="outline">Rent {monthlyRent.toFixed(4)} ETH/mo</Badge> : null}
        </div>
        <div className="absolute bottom-3 left-3 right-3">
          <h3 className="truncate text-lg font-semibold tracking-tight">{property.name}</h3>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /> {property.location}</div>
        </div>
      </PropertyImageCarousel>
      <CardContent className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Fact label="Total value" value={formatCurrency(property.total_value)} />
          <Fact label="Token price" value={`${tokenPrice.toFixed(4)} ETH`} />
          <Fact label="Available" value={formatNumber(available)} />
          <Fact label="Symbol" value={property.token_symbol} />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Sold</span>
            <span className="font-medium tabular-nums">{soldPct.toFixed(1)}%</span>
          </div>
          <Progress value={soldPct} className="h-1.5" />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="min-w-0 text-[11px] text-muted-foreground">
            {property.token_address ? <span className="font-mono">{shortAddress(property.token_address, 6, 4)}</span> : "Token contract pending"}
          </div>
          <Button size="sm" disabled={!wallet || !investable} onClick={() => setOpen(true)}>
            Invest <ArrowUpRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
      <InvestDialog property={property} wallet={wallet} open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function InvestDialog({ property, wallet, open, onOpenChange }: { property: Property; wallet: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [amount, setAmount] = useState("1");
  const [step, setStep] = useState<"idle" | "prepare" | "wallet" | "confirm">("idle");
  const [busy, setBusy] = useState(false);
  const tokenAmount = Math.max(0, Math.trunc(Number(amount || 0)));
  const costWei = investmentCostWei(property, tokenAmount);
  const costEth = Number(costWei) / 1e18;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!wallet || !property.token_address || tokenAmount <= 0) return;
    setBusy(true);
    try {
      setStep("prepare");
      const prepared = await api.post<InvestmentPrepareResponse>("/investments/prepare", {
        property_id: property.id,
        investor_wallet: wallet,
        token_amount: tokenAmount,
      });
      setStep("wallet");
      const tx = await sendInvestmentTx({ tokenAddress: property.token_address, propertyId: property.id, tokenAmount, valueWei: prepared.eth_amount_wei });
      const receipt = await tx.wait();
      setStep("confirm");
      await api.post(`/investments/${prepared.investment_id}/confirm`, { tx_hash: tx.hash });
      toast.success(`Investment confirmed in block ${receipt?.blockNumber ?? "latest"}.`);
      emitWorkflowCompletion({
        modal: "INVEST_PROPERTY",
        status: "success",
        message: `Investment confirmed: ${tokenAmount} ${property.token_symbol || "tokens"} in ${property.name}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["investor"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.properties });
      onOpenChange(false);
      setStep("idle");
    } catch (err: any) {
      const errMsg = err?.message || "Investment failed.";
      toast.error(errMsg);
      emitWorkflowCompletion({ modal: "INVEST_PROPERTY", status: "error", message: errMsg });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    return subscribeWorkflowAction((action) => {
      if (!isWorkflowModalAction(action, "INVEST_PROPERTY")) return;
      if (action.type === "FILL_FIELD" && action.field === "token_amount") {
        setAmount(String(action.value ?? ""));
        return;
      }
      if (action.type === "FOCUS_FIELD" && action.field) {
        window.setTimeout(() => focusWorkflowField("INVEST_PROPERTY", action.field!), 80);
        return;
      }
      if (action.type === "SUBMIT_FORM") {
        const trySubmit = (attemptsLeft: number) => {
          window.setTimeout(() => {
            if (formRef.current) {
              formRef.current.requestSubmit();
              return;
            }
            if (attemptsLeft > 0) trySubmit(attemptsLeft - 1);
          }, 180);
        };
        trySubmit(24);
        return;
      }
    });
  }, [property.id]);

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="max-w-md"
        onPointerDownOutside={preventCloseFromWorkflowBubble}
        onInteractOutside={preventCloseFromWorkflowBubble}
      >
        <DialogHeader>
          <DialogTitle>Invest in {property.name}</DialogTitle>
          <DialogDescription>Buy ownership tokens directly from the property SecurityToken contract.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-1.5">
            <Label>Token amount</Label>
            <Input data-workflow-field="INVEST_PROPERTY.token_amount" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <Fact label="Estimated cost" value={`${costEth.toFixed(6)} ETH`} />
            <Fact label="Wallet" value={shortAddress(wallet, 6, 4)} />
            <Fact label="Token price" value={`${Number(property.token_sale_price_eth ?? 0).toFixed(4)} ETH`} />
            <Fact label="Available" value={formatNumber(property.tokens_available ?? 0)} />
          </div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <Step active={step === "prepare"} done={["wallet", "confirm"].includes(step)} icon={ShieldCheck} label="Preparing backend quote" />
            <Step active={step === "wallet"} done={step === "confirm"} icon={Wallet} label="Confirming transaction in MetaMask" />
            <Step active={step === "confirm"} done={false} icon={CheckCircle2} label="Indexing investment on backend" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || tokenAmount <= 0 || !wallet}>{busy ? "Processing…" : "Invest via MetaMask"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex flex-col gap-0.5"><span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{value}</span></div>;
}

function Step({ active, done, icon: Icon, label }: { active: boolean; done: boolean; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return <div className={cn("flex items-center gap-2 rounded-md border border-border px-2.5 py-2", active && "border-primary/40 bg-primary/5 text-primary", done && "border-success/40 bg-success/5 text-success")}><Icon className="h-3.5 w-3.5" /> {label}</div>;
}
