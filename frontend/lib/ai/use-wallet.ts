"use client";

import { useState, useEffect } from "react";
import { getSession } from "@/lib/api";

export function useCurrentWallet(): string | null {
  const [wallet, setWallet] = useState<string | null>(null);

  useEffect(() => {
    function refresh() {
      const s = getSession();
      setWallet(s?.user?.wallet_address ?? null);
    }
    refresh();
    window.addEventListener("estatechain:session-changed", refresh);
    return () => window.removeEventListener("estatechain:session-changed", refresh);
  }, []);

  return wallet;
}
