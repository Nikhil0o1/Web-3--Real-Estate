export const RUNTIME_CONFIG = {
  apiBaseUrl: (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, ""),
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
