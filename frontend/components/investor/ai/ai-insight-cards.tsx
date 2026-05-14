"use client";

import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Coins, Shield, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ClaimableRewardsSummary, PortfolioResponse, Property } from "@/lib/types";
import { useInvestorCopilotStore } from "@/lib/ai/investor-copilot-store";
import { buildInvestorMetrics } from "@/components/investor/investor-utils";
import { formatNumber } from "@/lib/utils";

type Props = {
  portfolio?: PortfolioResponse;
  properties?: Property[];
  claimable?: ClaimableRewardsSummary;
};

type Insight = {
  id: string;
  title: string;
  detail: string;
  cta: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "risk" | "opportunity" | "yield";
  command: string;
};

export function AiInsightCards({ portfolio, properties, claimable }: Props) {
  const sendMessage = useInvestorCopilotStore((s) => s.sendMessage);
  const structured = useInvestorCopilotStore((s) => s.lastStructured);

  const holdings = portfolio?.holdings ?? [];
  const metrics = buildInvestorMetrics(holdings, properties ?? []);
  const claimableEth = Number(claimable?.total_claimable_eth ?? 0);
  const concentrationApprox = metrics.propertiesOwned <= 1 ? 92 : Math.max(25, 100 / metrics.propertiesOwned);
  const topRank = Array.isArray(structured?.analytics_summary?.ranked_top)
    ? (structured?.analytics_summary?.ranked_top as Array<Record<string, unknown>>)[0]
    : null;

  const cards: Insight[] = [
    {
      id: "risk",
      title: "Portfolio Risk Watch",
      detail:
        concentrationApprox >= 70
          ? `Concentration is elevated (~${formatNumber(concentrationApprox, 0)}%). Diversification analysis recommended.`
          : `Concentration is improving (~${formatNumber(concentrationApprox, 0)}%). Continue balancing exposures.`,
      cta: "Analyze diversification",
      icon: concentrationApprox >= 70 ? AlertTriangle : Shield,
      tone: "risk",
      command: "Analyze my portfolio diversification and concentration risk.",
    },
    {
      id: "yield",
      title: "Unclaimed Rewards Signal",
      detail:
        claimableEth > 0
          ? `${formatNumber(claimableEth, 4)} ETH is claimable now across ${claimable?.properties?.length ?? 0} properties.`
          : "No immediate claimable rewards detected. Monitoring payout accruals.",
      cta: claimableEth > 0 ? "Prepare claim strategy" : "Forecast passive income",
      icon: Coins,
      tone: "yield",
      command:
        claimableEth > 0
          ? "Show best claim and reinvest strategy for my current rewards."
          : "Compare passive income opportunities and expected reward growth.",
    },
    {
      id: "opportunity",
      title: "Highest Yield Opportunity",
      detail: topRank
        ? `Property ${String(topRank.property_id ?? "?")} is currently top-ranked by orchestration score.`
        : "Ask Copilot to rank safest, highest-yield opportunities in the marketplace.",
      cta: "Find best opportunities",
      icon: topRank ? TrendingUp : Sparkles,
      tone: "opportunity",
      command: "Find safest property with strongest yield and prepare an investment recommendation.",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: index * 0.04 }}
          >
            <Card className="relative overflow-hidden border-border/70 bg-card/70 backdrop-blur-sm">
              <div
                className="pointer-events-none absolute -right-12 -top-16 h-32 w-32 rounded-full blur-2xl"
                style={{
                  background:
                    card.tone === "risk"
                      ? "hsl(var(--warning) / 0.25)"
                      : card.tone === "yield"
                        ? "hsl(var(--success) / 0.20)"
                        : "hsl(var(--primary) / 0.25)",
                }}
              />
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <div className="grid h-8 w-8 place-items-center rounded-md bg-background/70 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="text-sm font-semibold">{card.title}</div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">{card.detail}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-md border-border/70 bg-background/50"
                  onClick={() => void sendMessage(card.command)}
                >
                  {card.cta}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
