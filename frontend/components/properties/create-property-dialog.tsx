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

export function CreatePropertyDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initial);
  const formRef = useRef<HTMLFormElement | null>(null);
  const currentFormRef = useRef(form);
  const create = useCreateProperty();
  const tokenPriceEth = calculateTokenPriceEth(form.total_value, form.token_supply);

  // Keep ref in sync with state for logging
  useEffect(() => {
    currentFormRef.current = form;
  }, [form]);

  function update<K extends keyof typeof initial>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    console.log("[CreatePropertyDialog] onSubmit called with form:", form);
    await submitWorkflowForm(form);
  }

  async function submitWorkflowForm(values: typeof initial) {
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
      clearPendingWorkflowActions("CREATE_PROPERTY");
      toast.success("Property created successfully.");
      emitWorkflowCompletion({
        modal: "CREATE_PROPERTY",
        status: "success",
        message: "Property created successfully.",
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

  useEffect(() => {
    console.log("[CreatePropertyDialog] Mounted, checking pending modal open");
    if (takePendingModalOpen("CREATE_PROPERTY")) {
      console.log("[CreatePropertyDialog] Found pending open, setting open=true");
      setOpen(true);
    }
    const handleAction = (action: any) => {
      console.log("[CreatePropertyDialog] Received action:", action.type, action);
      if (!isWorkflowModalAction(action, "CREATE_PROPERTY")) return;
      if (action.type === "OPEN_MODAL") {
        console.log("[CreatePropertyDialog] Opening modal");
        currentFormRef.current = initial;
        setForm(initial);
        setOpen(true);
        return;
      }
      if (action.type === "FILL_FIELD" && action.field) {
        const key = action.field as keyof typeof initial;
        const value = String(action.value ?? "");
        console.log("[CreatePropertyDialog] Filling field:", key, "=", value);
        if (key !== "images" && Object.prototype.hasOwnProperty.call(initial, key)) {
          currentFormRef.current = { ...currentFormRef.current, [key]: value };
          setForm((f) => ({ ...f, [key]: value }));
          const input = document.querySelector<HTMLInputElement>(`[data-workflow-field="CREATE_PROPERTY.${key}"]`);
          if (input) {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            console.log("[CreatePropertyDialog] Set DOM value for:", key);
          }
        }
        return;
      }
      if (action.type === "FOCUS_FIELD" && action.field) {
        console.log("[CreatePropertyDialog] Focusing field:", action.field);
        window.setTimeout(() => focusWorkflowField("CREATE_PROPERTY", action.field!), 80);
        return;
      }
      if (action.type === "SUBMIT_FORM") {
        console.log("[CreatePropertyDialog] SUBMIT_FORM received, opening modal");
        setOpen(true);
        window.setTimeout(() => {
          const currentForm = currentFormRef.current;
          console.log("[CreatePropertyDialog] Submitting with form state:", currentForm);
          if (!currentForm.name || !currentForm.location || !currentForm.total_value || !currentForm.token_supply || !currentForm.token_symbol) {
            console.error("[CreatePropertyDialog] Missing required fields!");
            toast.error("Please fill all required fields.");
            return;
          }
          void submitWorkflowForm(currentForm);
        }, 800);
      }
    };

    const drainPendingActions = () => {
      const pending = takePendingWorkflowActions("CREATE_PROPERTY");
      console.log("[CreatePropertyDialog] Draining pending actions:", pending);
      for (const action of pending) {
        handleAction(action);
      }
    };

    drainPendingActions();
    const timers = [100, 350, 800, 1500, 2500].map((ms) => window.setTimeout(drainPendingActions, ms));
    const unsubscribe = subscribeWorkflowAction(handleAction);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
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
