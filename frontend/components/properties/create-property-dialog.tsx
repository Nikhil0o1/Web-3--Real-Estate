"use client";

import { useEffect, useRef, useState } from "react";
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
  clearPendingWorkflowActions,
  emitWorkflowCompletion,
  focusWorkflowField,
  isWorkflowModalAction,
  preventCloseFromWorkflowBubble,
  subscribeWorkflowAction,
  takePendingModalOpen,
  takePendingWorkflowActions,
} from "@/lib/ai/action-executor";
import {
  PropertyFormField,
  calculateTokenPriceEth,
  formatTokenPriceEth,
  propertyDialogBodyClass,
  propertyDialogContentClass,
  propertyDialogFooterClass,
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

type FormState = typeof initial;

const TEXT_FIELDS: ReadonlyArray<keyof FormState> = [
  "name",
  "location",
  "total_value",
  "token_supply",
  "token_symbol",
  "monthly_rent_eth",
];

export function CreatePropertyDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(initial);
  const formRef = useRef<HTMLFormElement | null>(null);
  const create = useCreateProperty();
  const tokenPriceEth = calculateTokenPriceEth(form.total_value, form.token_supply);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ───────────────────────────────────────────────────────────────
  // Submit — SINGLE source of truth for "create the property".
  //
  // Runs the same way whether the user clicked Create themselves OR
  // the AI agent clicked it via the action-executor's visible
  // button-press. On success we emit the workflow-completion event,
  // which is what makes the chat bubble / voice session say
  // "Property created successfully" — without it the agent stays
  // silent and the UI looks frozen.
  // ───────────────────────────────────────────────────────────────
  async function submitWorkflowForm(values: FormState) {
    try {
      const price = calculateTokenPriceEth(values.total_value, values.token_supply);
      await create.mutateAsync({
        name: values.name.trim(),
        location: values.location.trim(),
        total_value: values.total_value,
        token_supply: values.token_supply,
        token_symbol: values.token_symbol.trim(),
        token_sale_price_eth: price > 0 ? price : "",
        monthly_rent_eth: values.monthly_rent_eth ? values.monthly_rent_eth : null,
        images: values.images,
      });
      const named = values.name.trim();
      const msg = named
        ? `Property '${named}' created successfully.`
        : "Property created successfully.";
      clearPendingWorkflowActions("CREATE_PROPERTY");
      toast.success(msg);
      emitWorkflowCompletion({
        modal: "CREATE_PROPERTY",
        status: "success",
        message: msg,
      });
      setForm(initial);
      setOpen(false);
    } catch (err: any) {
      clearPendingWorkflowActions("CREATE_PROPERTY");
      const errMsg = err?.message || "Failed to create property.";
      toast.error(errMsg);
      emitWorkflowCompletion({ modal: "CREATE_PROPERTY", status: "error", message: errMsg });
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitWorkflowForm(form);
  }

  // ───────────────────────────────────────────────────────────────
  // AI agent listener — open the dialog, fill / focus fields.
  //
  // We deliberately DO NOT submit from here. The action-executor
  // performs a visible click on the Create button when it gets a
  // SUBMIT_FORM action, which goes through the form's normal
  // onSubmit handler above. One submit path, no double-fires.
  // ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleAction = (action: any) => {
      if (!isWorkflowModalAction(action, "CREATE_PROPERTY")) return;

      if (action.type === "OPEN_MODAL") {
        setForm(initial);
        setOpen(true);
        return;
      }

      if (action.type === "FILL_FIELD" && action.field) {
        const key = action.field as keyof FormState;
        if (!TEXT_FIELDS.includes(key)) return;
        const value = String(action.value ?? "");
        setForm((f) => ({ ...f, [key]: value }));
        // Mirror into the live DOM input so the visible field matches
        // React state even if the user is mid-edit on something else.
        const input = document.querySelector<HTMLInputElement>(
          `[data-workflow-field="CREATE_PROPERTY.${key}"]`,
        );
        if (input && input.value !== value) {
          const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
          desc?.set?.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return;
      }

      if (action.type === "FOCUS_FIELD" && action.field) {
        window.setTimeout(
          () => focusWorkflowField("CREATE_PROPERTY", action.field!),
          80,
        );
        return;
      }

      // SUBMIT_FORM intentionally NOT handled here — the action-
      // executor clicks the visible Create button which triggers
      // onSubmit above.
    };

    // Catch an OPEN_MODAL that arrived before mount (e.g. fired
    // during the NAVIGATE that landed us on this page).
    if (takePendingModalOpen("CREATE_PROPERTY")) {
      setForm(initial);
      setOpen(true);
    }
    const drain = () => {
      for (const a of takePendingWorkflowActions("CREATE_PROPERTY")) handleAction(a);
    };
    drain();
    const timers = [80, 240, 600, 1200].map((ms) => window.setTimeout(drain, ms));
    const unsubscribe = subscribeWorkflowAction(handleAction);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      unsubscribe();
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5" data-workflow-modal-trigger="CREATE_PROPERTY">
          <Plus className="h-3.5 w-3.5" />
          Create Property
        </Button>
      </DialogTrigger>
      <DialogContent
        className={propertyDialogContentClass}
        onPointerDownOutside={preventCloseFromWorkflowBubble}
        onInteractOutside={preventCloseFromWorkflowBubble}
      >
        <DialogHeader className="border-b border-border/60 px-6 pb-3 pt-5">
          <DialogTitle>Create Property</DialogTitle>
          <DialogDescription>
            The platform will deploy the token and sync the rent setup after creation.
          </DialogDescription>
        </DialogHeader>
        <form
          ref={formRef}
          onSubmit={onSubmit}
          className={cn(propertyFormClass, propertyDialogBodyClass)}
          data-workflow-form="CREATE_PROPERTY"
        >
          <PropertyFormField label="Name">
            <Input
              data-workflow-field="CREATE_PROPERTY.name"
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="Oceanview Apartments"
            />
          </PropertyFormField>
          <PropertyFormField label="Location">
            <Input
              data-workflow-field="CREATE_PROPERTY.location"
              required
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="Miami, USA"
            />
          </PropertyFormField>
          <div className={propertyFormGridClass}>
            <PropertyFormField label="Total Value (ETH)">
              <Input
                data-workflow-field="CREATE_PROPERTY.total_value"
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
                data-workflow-field="CREATE_PROPERTY.token_supply"
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
                data-workflow-field="CREATE_PROPERTY.token_symbol"
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
              data-workflow-field="CREATE_PROPERTY.monthly_rent_eth"
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
          <DialogFooter className={propertyDialogFooterClass}>
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
