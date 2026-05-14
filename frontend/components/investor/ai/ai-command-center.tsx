"use client";

import { RoleCopilotCommandCenter } from "@/components/ai/role-copilot-command-center";
import { useInvestorCopilotStore } from "@/lib/ai/investor-copilot-store";

const PROMPTS = [
  "Analyze my portfolio",
  "Find safest property with highest yield",
  "Prepare investment for property #1 with 10 tokens",
  "Compare passive income opportunities",
] as const;

export function AiCommandCenter() {
  return (
    <RoleCopilotCommandCenter
      useStore={useInvestorCopilotStore}
      title="Investor AI Command Center"
      description="Orchestration-aware conversation, execution progress, and actionable investment intelligence."
      prompts={PROMPTS}
      emptyStateHint='Start with "Analyze my portfolio" to generate AI-native investor guidance.'
      inputPlaceholder="Ask for opportunities, risk analysis, or transaction preparation…"
      executionProfile="investor"
    />
  );
}
