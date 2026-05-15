"use client";

import { Label } from "@/components/ui/label";
import { cn, formatEth } from "@/lib/utils";

/** Per-token sale price in ETH from total property value (ETH) ÷ token supply. */
export function calculateTokenPriceEth(totalValueEth: string, tokenSupply: string): number {
  const total = Number(totalValueEth);
  const supply = Number(tokenSupply);
  if (!Number.isFinite(total) || !Number.isFinite(supply) || total <= 0 || supply <= 0) return 0;
  return total / supply;
}

export function formatTokenPriceEth(priceEth: number, digits = 6): string {
  if (priceEth <= 0) return "";
  return formatEth(priceEth, { digits });
}

export const propertyDialogContentClass =
  "max-w-[min(100vw-2rem,28rem)] gap-4 overflow-x-hidden p-6 sm:max-w-md";

export const propertyFormClass = "grid min-w-0 gap-3";

export const propertyFormGridClass = "grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2";

export function PropertyFormField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <Label className="text-xs">{label}</Label>
      <div className="min-w-0 [&_input]:min-w-0 [&_input]:w-full [&_input]:max-w-full">{children}</div>
    </div>
  );
}
