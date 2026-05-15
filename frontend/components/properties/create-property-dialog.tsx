"use client";

import { useState } from "react";
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
import { useCreateProperty } from "@/lib/mutations";
import { cn } from "@/lib/utils";
import { PropertyImageUploader } from "@/components/properties/property-image-uploader";
import {
  PropertyFormField,
  calculateTokenPriceEth,
  formatTokenPriceEth,
  propertyDialogContentClass,
  propertyFormClass,
  propertyFormGridClass,
} from "@/components/properties/property-form-shared";

const CREATE_STEPS = [
  "Creating property…",
  "Deploying token…",
  "Syncing blockchain…",
  "Finalizing inventory…",
] as const;

const initial = {
  name: "",
  location: "",
  total_value: "",
  token_supply: "",
  token_symbol: "",
  monthly_rent_eth: "",
  images: [] as string[],
};

export function CreatePropertyDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const create = useCreateProperty();
  const tokenPriceEth = calculateTokenPriceEth(form.total_value, form.token_supply);

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
        token_sale_price_eth: tokenPriceEth > 0 ? tokenPriceEth : "",
        monthly_rent_eth: form.monthly_rent_eth ? form.monthly_rent_eth : null,
        images: form.images,
      });
      toast.success("Property created successfully.");
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
      <DialogContent className={propertyDialogContentClass}>
        <DialogHeader>
          <DialogTitle>Create Property</DialogTitle>
          <DialogDescription>
            The platform will deploy the token and sync the rent setup after creation.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className={propertyFormClass}>
          <PropertyFormField label="Name">
            <Input
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Oceanview Apartments"
            />
          </PropertyFormField>
          <PropertyFormField label="Location">
            <Input
              required
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="Miami, USA"
            />
          </PropertyFormField>
          <div className={propertyFormGridClass}>
            <PropertyFormField label="Total Value (ETH)">
              <Input
                required
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={form.total_value}
                onChange={(e) => update("total_value", e.target.value)}
                placeholder="10"
              />
            </PropertyFormField>
            <PropertyFormField label="Token Supply">
              <Input
                required
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={form.token_supply}
                onChange={(e) => update("token_supply", e.target.value)}
                placeholder="10000"
              />
            </PropertyFormField>
          </div>
          <div className={propertyFormGridClass}>
            <PropertyFormField label="Symbol">
              <Input
                required
                value={form.token_symbol}
                onChange={(e) => update("token_symbol", e.target.value)}
                placeholder="OCEAN"
              />
            </PropertyFormField>
            <PropertyFormField label="Token Price (ETH, auto)">
              <Input
                readOnly
                tabIndex={-1}
                value={formatTokenPriceEth(tokenPriceEth)}
                placeholder="Calculated"
                className="bg-muted/40"
              />
            </PropertyFormField>
          </div>
          <p className="-mt-1 break-words text-xs text-muted-foreground">
            {tokenPriceEth > 0
              ? `${formatTokenPriceEth(tokenPriceEth)} per token (total value ÷ supply).`
              : "Enter total value in ETH and token supply to calculate price."}
          </p>
          <PropertyFormField label="Monthly Rent (ETH, optional)">
            <Input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={form.monthly_rent_eth}
              onChange={(e) => update("monthly_rent_eth", e.target.value)}
              placeholder="0.5"
            />
          </PropertyFormField>
          <PropertyImageUploader
            images={form.images}
            onChange={(images) => setForm((f) => ({ ...f, images }))}
          />
          {create.isPending ? (
            <div className="rounded-lg border border-border bg-muted/25 p-3">
              <ul className="space-y-1.5 text-xs">
                {CREATE_STEPS.map((label, index) => (
                  <li
                    key={label}
                    className={cn(
                      "flex items-center gap-2 text-muted-foreground transition-colors",
                      index === 0 && "font-medium text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40",
                        index === 0 && "animate-pulse bg-primary",
                      )}
                    />
                    {label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
