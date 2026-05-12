"use client";

import { useEffect, useState } from "react";
import { getSession, type SessionRecord } from "@/lib/api";

export function useCurrentWallet() {
  const [session, setSession] = useState<SessionRecord | null>(null);

  useEffect(() => {
    setSession(getSession());
    const handler = () => setSession(getSession());
    window.addEventListener("estatechain:session-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("estatechain:session-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  return session?.user?.wallet_address ?? null;
}
