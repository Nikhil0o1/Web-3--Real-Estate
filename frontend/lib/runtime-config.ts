function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/$/, "");
}

/** Prefer https for public API URL when env uses http (avoids mixed content on Vercel). */
export function coerceApiBaseUrlForBuild(url: string): string {
  const u = stripTrailingSlash(url);
  if (!u) return u;
  const isLocal = /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u);
  if (!isLocal && process.env.NODE_ENV === "production" && u.startsWith("http://")) {
    return "https://" + u.slice("http://".length);
  }
  return u;
}

export const RUNTIME_CONFIG = {
  apiBaseUrl: coerceApiBaseUrlForBuild(process.env.NEXT_PUBLIC_API_BASE_URL || ""),
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111),
  explorerTxBase: process.env.NEXT_PUBLIC_EXPLORER_TX_BASE || "https://sepolia.etherscan.io/tx/",
};

export function expectedChainHex(): string {
  return "0x" + RUNTIME_CONFIG.chainId.toString(16);
}

export function txExplorerUrl(hash?: string | null): string {
  if (!hash) return "#";
  return `${RUNTIME_CONFIG.explorerTxBase}${hash}`;
}
