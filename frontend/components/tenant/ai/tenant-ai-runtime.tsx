"use client";

import { useEffect } from "react";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";
import { useTenantCopilotStore } from "@/lib/ai/tenant-copilot-store";

export function TenantAiRuntime() {
  const wallet = useCurrentWallet();
  const hydrateForWallet = useTenantCopilotStore((s) => s.hydrateForWallet);
  const setCommandPaletteOpen = useTenantCopilotStore((s) => s.setCommandPaletteOpen);

  useEffect(() => {
    hydrateForWallet(wallet ?? null);
  }, [wallet, hydrateForWallet]);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [setCommandPaletteOpen]);

  return null;
}
