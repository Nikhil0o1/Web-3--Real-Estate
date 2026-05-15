"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useUpdateProperty } from "@/lib/mutations";
import { formatCurrency } from "@/lib/utils";
import { PropertyImageUploader } from "@/components/properties/property-image-uploader";
import type { Property } from "@/lib/types";

let listeners = new Set<(p: Property | null) => void>();
let current: Property | null = null;

function set(value: Property | null) {
  current = value;
  listeners.forEach((cb) => cb(value));
}

export function useEditPropertyDialog() {
  return {
    openEdit: (property: Property) => set(property),
    closeEdit: () => set(null),
  };
}

export function EditPropertyDialogHost() {
  const [property, setProperty] = useState<Property | null>(current);

  useEffect(() => {
    listeners.add(setProperty);
    return () => {
      listeners.delete(setProperty);
    };
  }, []);

  if (!property) return null;
  return <EditPropertyDialog property={property} onClose={() => set(null)} />;
}

function EditPropertyDialog({ property, onClose }: { property: Property; onClose: () => void }) {
  const [form, setForm] = useState({
    name: property.name,
    location: property.location,
    total_value: String(property.total_value ?? ""),
    token_supply: String(property.token_supply ?? ""),
    token_symbol: property.token_symbol,
    monthly_rent_eth: property.monthly_rent_eth ? String(property.monthly_rent_eth) : "",
    images: property.images ?? [],
  });
  const update = useUpdateProperty(property.id);
  const tokenPrice = property.token_address
    ? Number(property.token_sale_price_eth ?? 0)
    : calculateTokenPrice(form.total_value, form.token_supply);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        name: form.name.trim(),
        location: form.location.trim(),
        total_value: form.total_value,
        token_supply: form.token_supply,
        token_symbol: form.token_symbol.trim(),
        token_sale_price_eth: tokenPrice > 0 ? tokenPrice : "",
        monthly_rent_eth: form.monthly_rent_eth || null,
        images: form.images,
      });
      toast.success("Property updated.");
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Update failed.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit #{property.id} — {property.name}</DialogTitle>
          <DialogDescription>
            Token sale price is locked once the SecurityToken is deployed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Location">
            <Input
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total Value">
              <Input
                type="number"
                step="0.01"
                value={form.total_value}
                disabled={!!property.token_address}
                onChange={(e) => setForm((f) => ({ ...f, total_value: e.target.value }))}
              />
            </Field>
            <Field label="Token Supply">
              <Input
                type="number"
                step="1"
                value={form.token_supply}
                disabled={!!property.token_address}
                onChange={(e) => setForm((f) => ({ ...f, token_supply: e.target.value }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Symbol">
              <Input
                value={form.token_symbol}
                disabled={!!property.token_address}
                onChange={(e) => setForm((f) => ({ ...f, token_symbol: e.target.value }))}
              />
            </Field>
            <Field label="Token Price (auto)">
              <Input
                readOnly
                tabIndex={-1}
                value={tokenPrice > 0 ? formatCurrency(tokenPrice) : ""}
                className="bg-muted/40"
              />
            </Field>
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">
            {property.token_address
              ? "Token economics are locked after deployment."
              : tokenPrice > 0
                ? `${formatCurrency(tokenPrice)} per token from total value / supply.`
                : "Enter value and supply to calculate price."}
          </p>
          <Field label="Monthly Rent (ETH)">
            <Input
              type="number"
              step="0.000000000000000001"
              value={form.monthly_rent_eth}
              onChange={(e) => setForm((f) => ({ ...f, monthly_rent_eth: e.target.value }))}
            />
          </Field>
          <PropertyImageUploader
            images={form.images}
            onChange={(images) => setForm((f) => ({ ...f, images }))}
          />
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function calculateTokenPrice(totalValue: string, tokenSupply: string) {
  const total = Number(totalValue);
  const supply = Number(tokenSupply);
  if (!Number.isFinite(total) || !Number.isFinite(supply) || total <= 0 || supply <= 0) return 0;
  return total / supply;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
