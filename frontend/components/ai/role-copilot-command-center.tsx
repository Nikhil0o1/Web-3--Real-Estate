"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Command,
  Loader2,
  PlayCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  User2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import type { StoreApi, UseBoundStore } from "zustand";
import { api } from "@/lib/api";
import type { RoleCopilotStoreState } from "@/lib/ai/create-role-copilot-store";
import type { PreparedTransaction, PreparedTransactionData, RecommendedAction } from "@/lib/ai/types";
import { sendClaimRewardsTx, sendInvestmentTx, sendPayRentTx } from "@/components/investor/contract-actions";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";
import { queryKeys } from "@/lib/queries";
import { cn, shortAddress } from "@/lib/utils";
import { CopilotCommandPalette } from "@/components/ai/copilot-command-palette";
import { OrchestrationFlowGraph } from "@/components/ai/orchestration-flow-graph";
import { OrchestrationTimeline } from "@/components/ai/orchestration-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type RoleCopilotExecutionProfile = "investor" | "property_owner" | "tenant";

export type RoleCopilotCommandCenterProps = {
  useStore: UseBoundStore<StoreApi<RoleCopilotStoreState>>;
  title: string;
  description: string;
  prompts: readonly string[];
  emptyStateHint: string;
  inputPlaceholder: string;
  executionProfile: RoleCopilotExecutionProfile;
};

function findPreparedByTool(list: PreparedTransaction[], tool: string) {
  return list.find((item) => item.tool === tool && item.ok);
}

/** Route tools may nest payloads under `result` — normalize for MetaMask helpers. */
function flattenPreparedData(data: PreparedTransactionData): Record<string, unknown> {
  const r = data as Record<string, unknown>;
  const inner = r.result;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return r;
}

export function RoleCopilotCommandCenter({
  useStore,
  title,
  description,
  prompts,
  emptyStateHint,
  inputPlaceholder,
  executionProfile,
}: RoleCopilotCommandCenterProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const wallet = useCurrentWallet();
  const [executingTool, setExecutingTool] = useState<string | null>(null);

  const {
    threadId,
    traceId,
    draft,
    setDraft,
    streaming,
    sendMessage,
    abortStream,
    messages,
    progress,
    activities,
    commandPaletteOpen,
    setCommandPaletteOpen,
    error,
    lastStructured,
    pushExecutionActivity,
  } = useStore((s) => s);

  const prepared = lastStructured?.prepared_transactions ?? [];
  const recommended = lastStructured?.recommended_actions ?? [];

  const latestAssistant = useMemo(
    () => [...messages].reverse().find((m) => m.role === "assistant"),
    [messages],
  );

  async function executePrepared(preparedTx: PreparedTransaction) {
    if (!preparedTx.ok) {
      toast.error(preparedTx.error || "Prepared payload is not executable.");
      return;
    }

    const raw = preparedTx.data ?? {};
    const data = flattenPreparedData(raw);
    try {
      setExecutingTool(preparedTx.tool);
      pushExecutionActivity(`Executing ${preparedTx.tool} — awaiting MetaMask approval.`);

      if (preparedTx.tool === "tx.prepare_investment") {
        if (executionProfile === "property_owner") {
          throw new Error("Investment signing is available from the investor experience.");
        }
        const propertyId = Number(data.property_id);
        const tokenAmount = Math.trunc(Number(data.token_amount));
        const valueWei = String(data.eth_amount_wei ?? "");
        const tokenAddress = String(data.recipient_address ?? "");
        const investmentId = Number(data.investment_id);
        if (!Number.isFinite(propertyId) || !Number.isFinite(tokenAmount) || !valueWei || !tokenAddress) {
          throw new Error("Prepared investment payload is incomplete.");
        }
        const tx = await sendInvestmentTx({
          tokenAddress,
          propertyId,
          tokenAmount,
          valueWei,
        });
        pushExecutionActivity(`Investment transaction submitted: ${shortAddress(tx.hash, 7, 5)}.`);
        await tx.wait();
        if (Number.isFinite(investmentId) && investmentId > 0) {
          await api.post(`/investments/${investmentId}/confirm`, { tx_hash: tx.hash });
        }
        queryClient.invalidateQueries({ queryKey: ["investor"] });
        queryClient.invalidateQueries({ queryKey: queryKeys.properties });
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions });
        toast.success("Investment executed and confirmed.");
        pushExecutionActivity("Investment confirmed and analytics refreshed.");
        return;
      }

      if (preparedTx.tool === "tx.prepare_claim_rewards") {
        if (executionProfile !== "investor") {
          throw new Error("Reward claims are executed from the investor dashboard.");
        }
        if (!wallet) throw new Error("Connect an investor wallet first.");
        const propertyId = Number(data.property_id);
        const rentContractAddress = String(data.rent_contract_address ?? "");
        if (!Number.isFinite(propertyId) || !rentContractAddress) {
          throw new Error("Prepared claim payload is incomplete.");
        }
        const tx = await sendClaimRewardsTx({ propertyId, rentContractAddress });
        pushExecutionActivity(`Claim transaction submitted: ${shortAddress(tx.hash, 7, 5)}.`);
        await tx.wait();
        await api.post("/rewards/confirm-claim", {
          property_id: propertyId,
          investor_wallet: wallet,
          tx_hash: tx.hash,
        });
        queryClient.invalidateQueries({ queryKey: ["investor"] });
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions });
        toast.success("Rewards claim executed and confirmed.");
        pushExecutionActivity("Rewards claim confirmed and balances refreshed.");
        return;
      }

      if (preparedTx.tool === "tx.prepare_rent_payment") {
        if (!wallet) throw new Error("Connect your wallet first.");
        const propertyId = Number(data.property_id);
        const rentContractAddress = String(data.rent_contract_address ?? "");
        const valueWei = String(data.monthly_rent_wei ?? data.eth_amount_wei ?? "");
        if (!Number.isFinite(propertyId) || !rentContractAddress || !valueWei) {
          throw new Error("Prepared rent payload is incomplete.");
        }
        const tx = await sendPayRentTx({ rentContractAddress, propertyId, valueWei });
        pushExecutionActivity(`Rent transaction submitted: ${shortAddress(tx.hash, 7, 5)}.`);
        await tx.wait();
        await api.post(`/tenant/pay-rent/confirm/${propertyId}`, { tx_hash: tx.hash, tenant_wallet: wallet });
        queryClient.invalidateQueries({ queryKey: ["tenant"] });
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions });
        toast.success("Rent payment executed and confirmed.");
        pushExecutionActivity("Rent payment confirmed.");
        return;
      }

      throw new Error(`Unsupported prepared tool for this surface: ${preparedTx.tool}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "MetaMask execution failed.";
      toast.error(message);
      pushExecutionActivity(`Execution failed: ${message}`);
    } finally {
      setExecutingTool(null);
    }
  }

  async function runRecommendedAction(action: RecommendedAction) {
    if (action.action_id === "open_tenant_payments") {
      router.push("/tenant/payments");
      return;
    }
    if (action.action_id === "open_tenant_rentals") {
      router.push("/tenant/rentals");
      return;
    }
    if (action.action_id === "review_top_property") {
      if (executionProfile === "property_owner") {
        router.push("/property_owner/analytics");
        return;
      }
      router.push("/investor/marketplace");
      return;
    }
    if (action.action_id === "sign_with_metamask") {
      const preparedInvest = findPreparedByTool(prepared, "tx.prepare_investment");
      if (preparedInvest && executionProfile === "investor") {
        await executePrepared(preparedInvest);
        return;
      }
      const preparedRent = findPreparedByTool(prepared, "tx.prepare_rent_payment");
      if (preparedRent && (executionProfile === "tenant" || executionProfile === "property_owner")) {
        await executePrepared(preparedRent);
        return;
      }
      toast.error("No prepared MetaMask payload is available for this action yet.");
      return;
    }
    await sendMessage(action.title);
  }

  return (
    <>
      {executionProfile !== "investor" ? (
        <CopilotCommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          title="Copilot command palette"
          prompts={prompts}
          onPick={(text) => void sendMessage(text)}
          disabled={streaming}
        />
      ) : null}
      <Card className="overflow-hidden rounded-lg border-border/70 bg-card shadow-sm">
        <CardHeader className="border-b border-border/60 bg-card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="h-4 w-4 text-primary" />
                {title}
              </CardTitle>
              <CardDescription className="max-w-prose text-xs leading-relaxed">{description}</CardDescription>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="h-8 rounded-full border-border/70 bg-background px-3 text-xs"
                  onClick={() => setCommandPaletteOpen(true)}
                  disabled={streaming}
                >
                  <Command className="h-3 w-3" />
                  Commands
                </Button>
                <Badge variant="muted" className="rounded-full text-[10px]">
                  thread {threadId ?? "new"}
                </Badge>
                <Badge variant="muted" className="hidden rounded-full text-[10px] lg:inline-flex">
                  trace {traceId ? shortAddress(traceId, 10, 6) : "--"}
                </Badge>
                <Badge variant={streaming ? "success" : "outline"} className="rounded-full text-[10px]">
                  {streaming ? "streaming" : "idle"}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4 p-3 sm:p-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-3">
          <div className="max-h-[320px] space-y-2 overflow-y-auto rounded-lg border border-border/70 bg-background p-3 scrollbar-thin">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={cn(
                    "rounded-md border px-3 py-2.5",
                    message.role === "assistant"
                      ? "border-border/70 bg-muted/20"
                      : "border-primary/30 bg-primary/10",
                  )}
                >
                  <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                    {message.role === "assistant" ? <Bot className="h-3 w-3" /> : <User2 className="h-3 w-3" />}
                    {message.role}
                    {message.status === "streaming" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  </div>
                  <p className="break-words text-sm leading-relaxed text-foreground">{message.content}</p>
                </motion.div>
              ))}
            </AnimatePresence>
            {messages.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{emptyStateHint}</div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {prompts.map((prompt) => (
                <Button
                  key={prompt}
                  size="xs"
                  variant="outline"
                  className="h-7 max-w-full rounded-full border-border/70 bg-background px-3 text-[11px]"
                  onClick={() => void sendMessage(prompt)}
                  disabled={streaming}
                >
                  <span className="truncate">{prompt}</span>
                </Button>
              ))}
            </div>
            <div className="flex min-w-0 gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={inputPlaceholder}
                className="h-10 min-w-0 border-border/70 bg-background"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage(draft);
                  }
                }}
              />
              {streaming ? (
                <Button variant="outline" size="default" className="h-10 px-3" onClick={abortStream}>
                  Stop
                </Button>
              ) : (
                <Button size="default" className="h-10 px-3" onClick={() => void sendMessage(draft)} disabled={!draft.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        </div>

        <div className="space-y-3">
          <OrchestrationFlowGraph streaming={streaming} executing={Boolean(executingTool)} />

          <section className="overflow-hidden rounded-lg border border-border/60 bg-muted/15">
            <div className="border-b border-border/60 px-3 py-3">
              <h3 className="text-sm font-semibold leading-none">Orchestration timeline</h3>
              <p className="mt-1 text-xs text-muted-foreground">Live cognition, tools, and lifecycle mirrored from the graph stream.</p>
            </div>
            <div className="px-3 py-3">
              <OrchestrationTimeline activities={activities} streaming={streaming} maxItems={56} />
              {progress.length > 0 ? (
                <div className="mt-3 rounded-md border border-dashed border-border/60 bg-background/30 p-2">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Latest progress</p>
                  <div className="space-y-1">
                    {progress.slice(-4).map((line, idx) => (
                      <div key={`${line}-${idx}`} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                        <Terminal className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                        <span className="leading-relaxed">{line}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-border/60 bg-muted/15">
            <div className="border-b border-border/60 px-3 py-3">
              <h3 className="text-sm font-semibold leading-none">Actionable AI Response</h3>
              <p className="mt-1 text-xs text-muted-foreground">Execute only with wallet approval (non-custodial).</p>
            </div>
            <div className="space-y-2 px-3 py-3">
              {latestAssistant?.structured?.message ? (
                <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2 text-xs leading-relaxed">
                  {latestAssistant.structured.message}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border p-2 text-xs text-muted-foreground">
                  Ask Copilot for a recommendation to unlock executable actions.
                </div>
              )}

              {recommended.map((action) => (
                <Button
                  key={action.action_id}
                  size="sm"
                  variant="outline"
                  className="h-8 w-full justify-start border-border/70 bg-background/50 text-xs"
                  onClick={() => void runRecommendedAction(action)}
                  disabled={streaming}
                >
                  <PlayCircle className="h-3.5 w-3.5" />
                  {action.title}
                </Button>
              ))}

              {prepared.map((prep) => (
                <Button
                  key={prep.tool}
                  size="sm"
                  className="h-8 w-full justify-start text-xs"
                  variant={prep.ok ? "default" : "destructive"}
                  disabled={
                    !prep.ok ||
                    Boolean(executingTool) ||
                    streaming ||
                    (prep.tool === "tx.prepare_claim_rewards" && !wallet) ||
                    (prep.tool === "tx.prepare_investment" && executionProfile !== "investor") ||
                    (prep.tool === "tx.prepare_rent_payment" && !wallet)
                  }
                  onClick={() => void executePrepared(prep)}
                >
                  {executingTool === prep.tool ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
                  {prep.ok ? `Execute ${prep.tool}` : prep.error || `Failed ${prep.tool}`}
                </Button>
              ))}

              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-success" />
                All executions require explicit MetaMask signature.
              </div>
            </div>
          </section>
        </div>
      </CardContent>
    </Card>
    </>
  );
}
