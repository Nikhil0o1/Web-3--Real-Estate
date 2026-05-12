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
    token_sale_price_eth: String(property.token_sale_price_eth ?? ""),
    monthly_rent_eth: property.monthly_rent_eth ? String(property.monthly_rent_eth) : "",
  });
  const update = useUpdateProperty(property.id);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        name: form.name.trim(),
        location: form.location.trim(),
        total_value: form.total_value,
        token_supply: form.token_supply,
        token_symbol: form.token_symbol.trim(),
        token_sale_price_eth: form.token_sale_price_eth,
        monthly_rent_eth: form.monthly_rent_eth || null,
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
                onChange={(e) => setForm((f) => ({ ...f, total_value: e.target.value }))}
              />
            </Field>
            <Field label="Token Supply">
              <Input
                type="number"
                step="1"
                value={form.token_supply}
                onChange={(e) => setForm((f) => ({ ...f, token_supply: e.target.value }))}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Symbol">
              <Input
                value={form.token_symbol}
                onChange={(e) => setForm((f) => ({ ...f, token_symbol: e.target.value }))}
              />
            </Field>
            <Field label="Token Price (ETH)">
              <Input
                type="number"
                step="0.000000000000000001"
                value={form.token_sale_price_eth}
                disabled={!!property.token_address}
                onChange={(e) => setForm((f) => ({ ...f, token_sale_price_eth: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="Monthly Rent (ETH)">
            <Input
              type="number"
              step="0.000000000000000001"
              value={form.monthly_rent_eth}
              onChange={(e) => setForm((f) => ({ ...f, monthly_rent_eth: e.target.value }))}
            />
          </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
