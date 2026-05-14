"use client";

import { createRoleCopilotStore } from "./create-role-copilot-store";

export const PROPERTY_OWNER_AI_QUICK_COMMANDS = [
  "Analyze occupancy trends",
  "Which property is underperforming?",
  "Forecast next quarter revenue",
  "Show investor participation insights",
  "Suggest pricing improvements",
];

export const usePropertyOwnerCopilotStore = createRoleCopilotStore({
  storagePrefix: "estatechain.property_owner.ai.v1",
  streamPath: "copilot/property-owner/chat/stream",
});
