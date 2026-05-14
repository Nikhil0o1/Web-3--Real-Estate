"use client";

import { useEffect } from "react";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";
import { usePropertyOwnerCopilotStore } from "@/lib/ai/property-owner-copilot-store";

export function PropertyOwnerAiRuntime() {
  const wallet = useCurrentWallet();
  const hydrateForWallet = usePropertyOwnerCopilotStore((s) => s.hydrateForWallet);
  const setCommandPaletteOpen = usePropertyOwnerCopilotStore((s) => s.setCommandPaletteOpen);

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
