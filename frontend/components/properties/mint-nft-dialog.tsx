"use client";

import { useState } from "react";
import { Award } from "lucide-react";
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
import { useMintPropertyNft } from "@/lib/mutations";
import type { Property } from "@/lib/types";

export function MintNftDialog({ properties }: { properties: Property[] }) {
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState<string>("");
  const [toAddress, setToAddress] = useState("");
  const [tokenUri, setTokenUri] = useState("");
  const mint = useMintPropertyNft();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = Number(propertyId);
    if (!id) return;
    try {
      await mint.mutateAsync({
        property_id: id,
        to_address: toAddress.trim(),
        token_uri: tokenUri.trim(),
      });
      toast.success("Property NFT minted.");
      setOpen(false);
      setPropertyId("");
      setToAddress("");
      setTokenUri("");
    } catch (err: any) {
      toast.error(err?.message || "Failed to mint NFT.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Award className="h-3.5 w-3.5" />
          Mint Property NFT
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mint Property NFT</DialogTitle>
          <DialogDescription>
            Issues a deed NFT from the shared PropertyNFT contract.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Property</Label>
            <select
              required
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.id} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label>Recipient Wallet</Label>
            <Input
              required
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              placeholder="0x…"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Token URI</Label>
            <Input
              required
              value={tokenUri}
              onChange={(e) => setTokenUri(e.target.value)}
              placeholder="ipfs://…"
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={mint.isPending}>
              {mint.isPending ? "Minting…" : "Mint NFT"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
