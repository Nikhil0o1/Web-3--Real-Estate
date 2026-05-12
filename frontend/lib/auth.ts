"use client";

import { BrowserProvider } from "ethers";
import { api, ApiError, clearSession, getSession, writeSession, type SessionRecord } from "./api";
import { expectedChainHex } from "./runtime-config";

declare global {
  interface Window {
    ethereum?: any;
  }
}

export type SignInResult =
  | { status: "authenticated"; session: SessionRecord }
  | { status: "needs_registration"; walletAddress: string };

export const VALID_ROLES = ["property_owner", "investor", "tenant"] as const;
export type Role = (typeof VALID_ROLES)[number];

function ensureMetaMask() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask is not installed. Install it from https://metamask.io.");
  }
}

async function requestAccount(): Promise<string> {
  ensureMetaMask();
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || !accounts.length) throw new Error("No wallet account authorized.");
  return accounts[0];
}

async function personalSign(address: string, message: string): Promise<string> {
  ensureMetaMask();
  return window.ethereum.request({
    method: "personal_sign",
    params: [message, address],
  }) as Promise<string>;
}

export async function ensureSepoliaNetwork() {
  ensureMetaMask();
  const expected = expectedChainHex();
  const current = (await window.ethereum.request({ method: "eth_chainId" })) as string;
  if (current?.toLowerCase() === expected.toLowerCase()) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expected }],
    });
  } catch (err: any) {
    if (err?.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: expected,
            chainName: "Sepolia Testnet",
            rpcUrls: ["https://rpc.sepolia.org"],
            nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function signIn(): Promise<SignInResult> {
  const wallet = await requestAccount();
  await ensureSepoliaNetwork();

  const challenge = await api.post<{ nonce: string; message: string; expires_at: string }>(
    "/auth/nonce",
    { wallet_address: wallet },
  );

  const signature = await personalSign(wallet, challenge.message);
  const verify = await api.post<{
    token: string;
    expires_at: string;
    user: SessionRecord["user"] & { registered?: boolean };
    is_new_user: boolean;
  }>("/auth/verify", { wallet_address: wallet, signature, nonce: challenge.nonce });

  if (verify.is_new_user) {
    return { status: "needs_registration", walletAddress: wallet.toLowerCase() };
  }

  const session: SessionRecord = {
    token: verify.token,
    user: verify.user,
    expires_at: verify.expires_at,
  };
  writeSession(session);
  return { status: "authenticated", session };
}

export async function registerWallet(params: {
  walletAddress: string;
  role: Role;
  email?: string | null;
}): Promise<SessionRecord> {
  const challenge = await api.post<{ nonce: string; message: string; expires_at: string }>(
    "/auth/nonce",
    { wallet_address: params.walletAddress },
  );
  const signature = await personalSign(params.walletAddress, challenge.message);
  const resp = await api.post<{ token: string; expires_at: string; user: SessionRecord["user"] }>(
    "/auth/register",
    {
      wallet_address: params.walletAddress,
      signature,
      nonce: challenge.nonce,
      role: params.role,
      email: params.email || null,
    },
  );
  const session: SessionRecord = { token: resp.token, expires_at: resp.expires_at, user: resp.user };
  writeSession(session);
  return session;
}

export async function refreshMe(): Promise<SessionRecord["user"] | null> {
  const session = getSession();
  if (!session) return null;
  try {
    const me = await api.get<SessionRecord["user"]>("/auth/me");
    writeSession({ ...session, user: me });
    return me;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      clearSession();
    }
    return null;
  }
}

export async function logout({ silent = false }: { silent?: boolean } = {}) {
  try {
    await api.post("/auth/logout");
  } catch {
    /* ignore */
  }
  clearSession();
  if (!silent && typeof window !== "undefined") {
    window.location.href = "/";
  }
}

export async function getEthBalance(address: string): Promise<number> {
  ensureMetaMask();
  try {
    const provider = new BrowserProvider(window.ethereum);
    const balance = await provider.getBalance(address);
    return Number(balance) / 1e18;
  } catch {
    return 0;
  }
}
