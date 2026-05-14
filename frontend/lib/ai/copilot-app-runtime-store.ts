"use client";

import { create } from "zustand";

/** In-app UI bus: deterministic state for copilot-driven screens (no DOM scraping). */
export type CopilotAppRuntimeState = {
  createPropertyPrefill: Record<string, string> | null;
  setCreatePropertyPrefill: (patch: Record<string, string> | null) => void;
  mergeCreatePropertyPrefill: (patch: Record<string, string>) => void;
  takeCreatePropertyPrefill: () => Record<string, string> | null;
};

export const useCopilotAppRuntime = create<CopilotAppRuntimeState>((set, get) => ({
  createPropertyPrefill: null,
  setCreatePropertyPrefill: (patch) => set({ createPropertyPrefill: patch }),
  mergeCreatePropertyPrefill: (patch) =>
    set((s) => ({
      createPropertyPrefill: { ...(s.createPropertyPrefill ?? {}), ...patch },
    })),
  takeCreatePropertyPrefill: () => {
    const v = get().createPropertyPrefill;
    set({ createPropertyPrefill: null });
    return v;
  },
}));
