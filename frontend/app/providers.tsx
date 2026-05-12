"use client";

import { ReactNode, useState, useEffect } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { useTheme } from "next-themes";
import { clearSession, getSession } from "@/lib/api";

function ToasterWithTheme() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      richColors
      closeButton
      position="top-right"
      theme={resolvedTheme === "dark" ? "dark" : "light"}
    />
  );
}

function MetaMaskListeners() {
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    const handleAccountsChanged = (accounts: string[]) => {
      const session = getSession();
      const sessionWallet = session?.user?.wallet_address?.toLowerCase();
      const newAddr = accounts?.[0]?.toLowerCase();
      if (!newAddr) {
        if (sessionWallet) {
          clearSession();
          window.location.href = "/";
        }
        return;
      }
      if (sessionWallet && newAddr !== sessionWallet) {
        clearSession();
        window.location.href = "/";
      }
    };
    const handleChainChanged = () => {
      window.dispatchEvent(new CustomEvent("estatechain:chain-changed"));
    };
    const handleDisconnect = () => {
      if (getSession()) {
        clearSession();
        window.location.href = "/";
      }
    };
    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);
    window.ethereum.on?.("disconnect", handleDisconnect);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
      window.ethereum?.removeListener?.("disconnect", handleDisconnect);
    };
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <MetaMaskListeners />
        {children}
        <ToasterWithTheme />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
