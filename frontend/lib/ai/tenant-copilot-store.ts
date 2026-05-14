"use client";

import { createRoleCopilotStore } from "./create-role-copilot-store";

export const TENANT_AI_QUICK_COMMANDS = [
  "When is my next payment?",
  "Show my rental history",
  "Can I afford another property?",
  "Summarize my recent payments",
];

export const useTenantCopilotStore = createRoleCopilotStore({
  storagePrefix: "estatechain.tenant.ai.v1",
  streamPath: "copilot/tenant/chat/stream",
});
