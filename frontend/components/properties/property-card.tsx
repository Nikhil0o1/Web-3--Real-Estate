"use client";

import { motion } from "framer-motion";
import { Archive, CheckCircle2, MapPin, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useDeleteProperty } from "@/lib/mutations";
import { useEditPropertyDialog } from "./edit-property-dialog";
import { PropertyImageCarousel } from "@/components/properties/property-image-carousel";
import type { Property } from "@/lib/types";
import { cn, formatCurrency, formatNumber, percent, shortAddress } from "@/lib/utils";
import { isWorkflowModalAction, subscribeWorkflowAction, workflowPropertyMatches } from "@/lib/ai/action-executor";
import { useEffect } from "react";
import { useCurrentWallet } from "@/components/investor/use-current-wallet";

export function PropertyCard({ property }: { property: Property }) {
  const remove = useDeleteProperty();
  const { openEdit } = useEditPropertyDialog();
  const wallet = useCurrentWallet();
  const canManage = Boolean(
    wallet && property.owner_wallet && property.owner_wallet.toLowerCase() === wallet.toLowerCase(),
  );

  const sold = Number(property.tokens_sold ?? 0);
  const total = Number(property.token_supply ?? 0);
  const soldPct = Number(property.sold_percentage ?? percent(sold, total));
  const tokenPriceEth = Number(property.token_sale_price_eth ?? 0);
  const monthlyRentEth = Number(property.monthly_rent_eth ?? 0);

  useEffect(() => {
    return subscribeWorkflowAction((action) => {
      if (!canManage) return;
      if (!isWorkflowModalAction(action, "EDIT_PROPERTY")) return;
      if (action.type === "OPEN_MODAL" && workflowPropertyMatches(action, property.id)) {
        openEdit(property);
      }
    });
  }, [canManage, openEdit, property]);

  async function handleArchive() {
    if (!window.confirm(`Archive or delete ${property.name}? Active on-chain/history records will be preserved.`)) return;
    try {
      const result = await remove.mutateAsync(property.id);
      toast.success(result.mode === "archived" ? "Property archived." : "Property deleted.");
    } catch (e: any) {
      toast.error(e?.message || "Archive failed.");
    }
  }

  return (
    <motion.div
      layout
      whileHover={{ y: -2 }}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      <PropertyImageCarousel images={property.images} propertyId={property.id} title={property.name} className="h-32 w-full">
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <Badge variant="muted" className="font-mono">#{property.id}</Badge>
          <Badge variant={property.token_address ? "success" : "warning"}>
            {property.token_address ? "Ready" : "Setup pending"}
          </Badge>
        </div>
        <div className="absolute bottom-3 left-3 right-3">
          <h3 className="truncate text-base font-semibold leading-tight">{property.name}</h3>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            <span className="truncate">{property.location}</span>
          </div>
        </div>
      </PropertyImageCarousel>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Stat label="Total Value" value={formatCurrency(property.total_value)} />
          <Stat label="Token Symbol" value={property.token_symbol} />
          <Stat label="Token Supply" value={formatNumber(total)} />
          <Stat label="Token Price" value={`${tokenPriceEth.toFixed(4)} ETH`} />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Tokens Sold</span>
            <span className="tabular-nums font-medium">
              {formatNumber(sold)} / {formatNumber(total)} ({soldPct.toFixed(1)}%)
            </span>
          </div>
          <Progress
            value={soldPct}
            className="h-1.5"
            indicatorClassName={cn(
              soldPct >= 60 ? "bg-success" : soldPct >= 30 ? "bg-chart-2" : "bg-chart-4",
            )}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {monthlyRentEth > 0 ? (
            <Badge variant="outline" className="rounded-md">
              Rent · {monthlyRentEth.toFixed(4)} ETH/mo
            </Badge>
          ) : (
            <Badge variant="muted" className="rounded-md">Rent not set</Badge>
          )}
          {property.token_address ? (
            <span className="font-mono text-[10px]">{shortAddress(property.token_address, 6, 4)}</span>
          ) : null}
          {property.nft_token_id ? (
            <Badge variant="outline" className="rounded-md">
              <CheckCircle2 className="mr-1 h-3 w-3" /> NFT #{property.nft_token_id}
            </Badge>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
          <TooltipProvider delayDuration={150}>
            <div className="flex items-center gap-1">
              {canManage ? (
                <>
                  <IconAction
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    label="Edit"
                    onClick={() => openEdit(property)}
                  />
                  <IconAction
                    icon={<Archive className="h-3.5 w-3.5" />}
                    label="Archive or delete"
                    busy={remove.isPending}
                    onClick={handleArchive}
                  />
                </>
              ) : null}
            </div>
          </TooltipProvider>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Available · {formatNumber(Number(property.tokens_available ?? 0))}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  );
}

function IconAction({
  icon,
  label,
  onClick,
  busy,
  variant,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  busy?: boolean;
  variant?: "primary";
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant === "primary" ? "default" : "ghost"}
          size="icon"
          className="h-7 w-7"
          disabled={busy}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
