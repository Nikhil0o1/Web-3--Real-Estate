"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ClaimableRewardsSummary, PortfolioResponse } from "@/lib/types";
import { useInvestorCopilotStore } from "@/lib/ai/investor-copilot-store";
import { buildInvestorMetrics } from "@/components/investor/investor-utils";
import { formatNumber } from "@/lib/utils";

export function AiPortfolioNarrative({
  portfolio,
  claimable,
}: {
  portfolio?: PortfolioResponse;
  claimable?: ClaimableRewardsSummary;
}) {
  const structured = useInvestorCopilotStore((s) => s.lastStructured);

  const holdings = portfolio?.holdings ?? [];
  const metrics = buildInvestorMetrics(holdings, []);
  const concentration =
    holdings.length <= 1 ? "heavily concentrated" : holdings.length <= 3 ? "moderately concentrated" : "broadly diversified";
  const claimableEth = Number(claimable?.total_claimable_eth ?? 0);
  const fallback = [
    `Your portfolio is ${concentration} across ${metrics.propertiesOwned} properties. Rebalancing into underrepresented asset clusters can improve resilience.`,
    claimableEth > 0
      ? `You currently have ${formatNumber(claimableEth, 4)} ETH in unclaimed rewards.`
      : "You currently have no unclaimed rewards and are compounding from active positions.",
  ];

  const narrative = [
    structured?.message,
    structured?.reasoning_summary,
    ...fallback,
  ].filter((line): line is string => Boolean(line && line.trim()));

  return (
    <Card className="border-border/70 bg-card/60 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          AI Portfolio Narrative
        </CardTitle>
        <CardDescription>Grounded commentary generated from deterministic analytics + orchestration context.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {narrative.slice(0, 3).map((line, index) => (
          <motion.p
            key={`${line}-${index}`}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, delay: index * 0.05 }}
            className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-foreground/95"
          >
            {line}
          </motion.p>
        ))}
      </CardContent>
    </Card>
  );
}
