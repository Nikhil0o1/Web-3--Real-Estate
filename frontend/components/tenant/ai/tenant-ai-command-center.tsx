"use client";

import { RoleCopilotCommandCenter } from "@/components/ai/role-copilot-command-center";
import { useTenantCopilotStore } from "@/lib/ai/tenant-copilot-store";

const PROMPTS = [
  "When is my next payment?",
  "Show my rental history",
  "Can I afford another property?",
  "Summarize my recent payments",
] as const;

export function TenantAiCommandCenter() {
  return (
    <RoleCopilotCommandCenter
      useStore={useTenantCopilotStore}
      title="Rental Intelligence Copilot"
      description="Payment reminders, affordability context, and rental summaries from the same orchestration runtime as investors."
      prompts={PROMPTS}
      emptyStateHint='Ask "When is my next payment?" or "Summarize my recent payments" to get started.'
      inputPlaceholder="Ask about rent, payments, affordability, or rentals…"
      executionProfile="tenant"
    />
  );
}
