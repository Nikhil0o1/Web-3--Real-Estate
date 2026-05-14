"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateProperty } from "@/lib/mutations";
import { useCopilotAppRuntime } from "@/lib/ai/copilot-app-runtime-store";

const initial = {
  name: "",
  location: "",
  total_value: "",
  token_supply: "",
  token_symbol: "",
  token_sale_price_eth: "",
  monthly_rent_eth: "",
};

export type CreatePropertyDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function CreatePropertyDialog({ open: openProp, onOpenChange: onOpenChangeProp }: CreatePropertyDialogProps = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = typeof openProp === "boolean" && typeof onOpenChangeProp === "function";
  const open = controlled ? openProp : uncontrolledOpen;
  const setOpen = controlled ? onOpenChangeProp : setUncontrolledOpen;
  const [form, setForm] = useState(initial);
  const create = useCreateProperty();

  useEffect(() => {
    if (!open) return;
    const patch = useCopilotAppRuntime.getState().takeCreatePropertyPrefill();
    if (!patch || Object.keys(patch).length === 0) return;
    setForm((f) => {
      const next = { ...f };
      const keys = ["name", "location", "total_value", "token_supply", "token_symbol", "token_sale_price_eth", "monthly_rent_eth"] as const;
      for (const k of keys) {
        if (patch[k] != null && String(patch[k]).length) (next as Record<string, string>)[k] = String(patch[k]);
      }
      return next;
    });
  }, [open]);

  function update<K extends keyof typeof initial>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        location: form.location.trim(),
        total_value: form.total_value,
        token_supply: form.token_supply,
        token_symbol: form.token_symbol.trim(),
        token_sale_price_eth: form.token_sale_price_eth,
        monthly_rent_eth: form.monthly_rent_eth ? form.monthly_rent_eth : null,
      });
      toast.success(`Created ${form.name}.`);
      setForm(initial);
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to create property.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Create Property
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Property</DialogTitle>
          <DialogDescription>
            DB-only. Deploy the SecurityToken from the property card afterwards.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <Field label="Name">
            <Input
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Oceanview Apartments"
            />
          </Field>
          <Field label="Location">
            <Input
              required
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="Miami, USA"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total Value (USD)">
              <Input
                required
                type="number"
                step="0.01"
                value={form.total_value}
                onChange={(e) => update("total_value", e.target.value)}
              />
            </Field>
            <Field label="Token Supply">
              <Input
                required
                type="number"
                step="1"
                value={form.token_supply}
                onChange={(e) => update("token_supply", e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Symbol">
              <Input
                required
                value={form.token_symbol}
                onChange={(e) => update("token_symbol", e.target.value)}
                placeholder="OCEAN"
              />
            </Field>
            <Field label="Token Price (ETH)">
              <Input
                required
                type="number"
                step="0.000000000000000001"
                value={form.token_sale_price_eth}
                onChange={(e) => update("token_sale_price_eth", e.target.value)}
                placeholder="0.001"
              />
            </Field>
          </div>
          <Field label="Monthly Rent (ETH, optional)">
            <Input
              type="number"
              step="0.000000000000000001"
              value={form.monthly_rent_eth}
              onChange={(e) => update("monthly_rent_eth", e.target.value)}
              placeholder="0.5"
            />
          </Field>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create"}
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
