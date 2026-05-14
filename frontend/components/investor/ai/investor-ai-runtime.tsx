"use client";

import { useEffect } from "react";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";
import { useInvestorCopilotStore } from "@/lib/ai/investor-copilot-store";

export function InvestorAiRuntime() {
  const wallet = useCurrentWallet();
  const hydrateForWallet = useInvestorCopilotStore((s) => s.hydrateForWallet);
  const setCommandPaletteOpen = useInvestorCopilotStore((s) => s.setCommandPaletteOpen);

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
