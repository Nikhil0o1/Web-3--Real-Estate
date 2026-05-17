"use client";

import { useEffect, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { useUpdateProperty } from "@/lib/mutations";
import { formatEth } from "@/lib/utils";
import { PropertyImageUploader } from "@/components/properties/property-image-uploader";
import {
  PropertyFormField,
  calculateTokenPriceEth,
  formatTokenPriceEth,
  propertyDialogContentClass,
  propertyFormClass,
  propertyFormGridClass,
} from "@/components/properties/property-form-shared";
import type { Property } from "@/lib/types";
import {
  emitWorkflowCompletion,
  focusWorkflowField,
  isWorkflowModalAction,
  preventCloseFromWorkflowBubble,
  subscribeWorkflowAction,
} from "@/lib/workflows/action-bus";

let listeners = new Set<(p: Property | null) => void>();
let current: Property | null = null;
const EDIT_FORM_FIELDS = new Set(["name", "location", "total_value", "token_supply", "token_symbol", "monthly_rent_eth"]);
type EditFormTextField = "name" | "location" | "total_value" | "token_supply" | "token_symbol" | "monthly_rent_eth";

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
  const formRef = useRef<HTMLFormElement | null>(null);
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
  const tokenPriceEth = property.token_address
    ? Number(property.token_sale_price_eth ?? 0)
    : calculateTokenPriceEth(form.total_value, form.token_supply);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        name: form.name.trim(),
        location: form.location.trim(),
        total_value: form.total_value,
        token_supply: form.token_supply,
        token_symbol: form.token_symbol.trim(),
        token_sale_price_eth: tokenPriceEth > 0 ? tokenPriceEth : "",
        monthly_rent_eth: form.monthly_rent_eth || null,
        images: form.images,
      });
      toast.success("Property updated.");
      emitWorkflowCompletion({
        modal: "EDIT_PROPERTY",
        status: "success",
        message: "Property updated successfully.",
      });
      onClose();
    } catch (err: any) {
      const errMsg = err?.message || "Update failed.";
      toast.error(errMsg);
      emitWorkflowCompletion({ modal: "EDIT_PROPERTY", status: "error", message: errMsg });
    }
  }

  useEffect(() => {
    return subscribeWorkflowAction((action) => {
      if (!isWorkflowModalAction(action, "EDIT_PROPERTY")) return;
      if (action.type === "FILL_FIELD") {
        if (EDIT_FORM_FIELDS.has(action.field)) {
          const key = action.field as EditFormTextField;
          setForm((f) => ({ ...f, [key]: String(action.value ?? "") }));
        }
        return;
      }
      if (action.type === "FOCUS_FIELD") {
        window.setTimeout(() => focusWorkflowField("EDIT_PROPERTY", action.field), 80);
        return;
      }
      if (action.type === "SUBMIT_FORM") {
        window.setTimeout(() => formRef.current?.requestSubmit(), 120);
      }
    });
  }, []);

  const tokenPriceDisplay = property.token_address
    ? formatEth(tokenPriceEth, { digits: 6 })
    : formatTokenPriceEth(tokenPriceEth);

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent
        className={propertyDialogContentClass}
        onPointerDownOutside={preventCloseFromWorkflowBubble}
        onInteractOutside={preventCloseFromWorkflowBubble}
      >
        <DialogHeader>
          <DialogTitle>Edit #{property.id} — {property.name}</DialogTitle>
          <DialogDescription>
            Token sale price is locked once the SecurityToken is deployed.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={onSubmit} className={propertyFormClass}>
          <PropertyFormField label="Name">
            <Input data-workflow-field="EDIT_PROPERTY.name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </PropertyFormField>
          <PropertyFormField label="Location">
            <Input
              data-workflow-field="EDIT_PROPERTY.location"
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            />
          </PropertyFormField>
          <div className={propertyFormGridClass}>
            <PropertyFormField label="Total Value (ETH)">
              <Input
                data-workflow-field="EDIT_PROPERTY.total_value"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={form.total_value}
                disabled={!!property.token_address}
                onChange={(e) => setForm((f) => ({ ...f, total_value: e.target.value }))}
              />
            </PropertyFormField>
            <PropertyFormField label="Token Supply">
              <Input
                data-workflow-field="EDIT_PROPERTY.token_supply"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={form.token_supply}
                disabled={!!property.token_address}
                onChange={(e) => setForm((f) => ({ ...f, token_supply: e.target.value }))}
              />
            </PropertyFormField>
          </div>
          <div className={propertyFormGridClass}>
            <PropertyFormField label="Symbol">
              <Input
                data-workflow-field="EDIT_PROPERTY.token_symbol"
                value={form.token_symbol}
                disabled={!!property.token_address}
                onChange={(e) => setForm((f) => ({ ...f, token_symbol: e.target.value }))}
              />
            </PropertyFormField>
            <PropertyFormField label="Token Price (ETH, auto)">
              <Input
                readOnly
                tabIndex={-1}
                value={tokenPriceDisplay}
                className="bg-muted/40"
              />
            </PropertyFormField>
          </div>
          <p className="-mt-1 break-words text-xs text-muted-foreground">
            {property.token_address
              ? "Token economics are locked after deployment."
              : tokenPriceEth > 0
                ? `${formatTokenPriceEth(tokenPriceEth)} per token (total value ÷ supply).`
                : "Enter total value in ETH and token supply to calculate price."}
          </p>
          <PropertyFormField label="Monthly Rent (ETH)">
            <Input
              data-workflow-field="EDIT_PROPERTY.monthly_rent_eth"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={form.monthly_rent_eth}
              onChange={(e) => setForm((f) => ({ ...f, monthly_rent_eth: e.target.value }))}
            />
          </PropertyFormField>
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
