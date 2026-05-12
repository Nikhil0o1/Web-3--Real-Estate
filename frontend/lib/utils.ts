import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddress(addr?: string | null, head = 6, tail = 4): string {
  if (!addr) return "--";
  const a = String(addr);
  if (a.length <= head + tail + 2) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function formatCurrency(value: number | string | null | undefined, currency = "USD"): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatNumber(value: number | string | null | undefined, fractionDigits = 0): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(n);
}

export function formatTokenAmount(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}

export function formatEth(weiOrEth: string | number | null | undefined, opts?: { fromWei?: boolean; digits?: number }): string {
  const fromWei = opts?.fromWei ?? false;
  const digits = opts?.digits ?? 4;
  const raw = Number(weiOrEth ?? 0);
  if (!Number.isFinite(raw)) return `0 ETH`;
  const eth = fromWei ? raw / 1e18 : raw;
  return `${eth.toFixed(digits)} ETH`;
}

export function percent(numerator: number | string | null | undefined, denominator: number | string | null | undefined, digits = 1): number {
  const n = Number(numerator ?? 0);
  const d = Number(denominator ?? 0);
  if (!d) return 0;
  return Number(((n / d) * 100).toFixed(digits));
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (!value) return "--";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "--";
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "--";
  }
}
