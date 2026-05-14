"use client";

import { RoleCopilotCommandCenter } from "@/components/ai/role-copilot-command-center";
import { usePropertyOwnerCopilotStore } from "@/lib/ai/property-owner-copilot-store";

const PROMPTS = [
  "Analyze occupancy trends",
  "Which property is underperforming?",
  "Forecast next quarter revenue",
  "Show investor participation insights",
  "Suggest pricing improvements",
] as const;

export function PropertyOwnerAiCommandCenter() {
  return (
    <RoleCopilotCommandCenter
      useStore={usePropertyOwnerCopilotStore}
      title="Property Intelligence Copilot"
      description="Operational analytics, occupancy signals, and revenue narratives grounded in your portfolio data."
      prompts={PROMPTS}
      emptyStateHint='Try "Analyze occupancy trends" or "Forecast next quarter revenue" to open the operational console.'
      inputPlaceholder="Ask about occupancy, revenue, investors, or pricing…"
      executionProfile="property_owner"
    />
  );
}
