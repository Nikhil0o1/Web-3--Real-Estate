"use client";

import { createRoleCopilotStore } from "./create-role-copilot-store";

export const INVESTOR_AI_QUICK_COMMANDS = [
  "Find safest property",
  "Analyze my portfolio diversification",
  "Prepare investment for 10 tokens",
  "Compare passive income opportunities",
];

export const useInvestorCopilotStore = createRoleCopilotStore({
  storagePrefix: "estatechain.investor.ai.v1",
  streamPath: "copilot/investor/chat/stream",
});
