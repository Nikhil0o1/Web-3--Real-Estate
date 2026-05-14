"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { AdminTopbar } from "@/components/layout/topbar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CreatePropertyDialog } from "@/components/properties/create-property-dialog";
import { MintNftDialog } from "@/components/properties/mint-nft-dialog";
import { PropertyCard } from "@/components/properties/property-card";
import { EditPropertyDialogHost } from "@/components/properties/edit-property-dialog";
import { EmptyState } from "@/components/common/empty";
import { useProperties } from "@/lib/queries";

function PropertiesPageContent() {
  const properties = useProperties();
  const [search, setSearch] = useState("");
  const searchParams = useSearchParams();
  const router = useRouter();
  const [copilotCreateOpen, setCopilotCreateOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("copilot_open") !== "create_property") return;
    setCopilotCreateOpen(true);
    router.replace("/property_owner/properties", { scroll: false });
  }, [searchParams, router]);

  const filtered = useMemo(() => {
    const list = properties.data ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.location || "").toLowerCase().includes(q),
    );
  }, [properties.data, search]);

  return (
    <>
      <AdminTopbar
        title="Properties"
        subtitle="Create, deploy, and manage tokenized listings — catalog and on-chain tokens"
      />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <div className="relative w-full sm:w-auto sm:min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search properties…"
              className="h-9 w-full pl-8 text-sm sm:w-64"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MintNftDialog properties={properties.data ?? []} />
            <CreatePropertyDialog open={copilotCreateOpen} onOpenChange={setCopilotCreateOpen} />
          </div>
        </div>

        {properties.isLoading && filtered.length === 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[320px] w-full rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No properties yet"
            description="Use Create Property to add your first listing."
          />
        ) : (
          <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <PropertyCard key={p.id} property={p} />
            ))}
          </motion.div>
        )}

        <EditPropertyDialogHost />
      </main>
    </>
  );
}

export default function PropertiesPage() {
  return (
    <Suspense
      fallback={
        <>
          <AdminTopbar title="Properties" subtitle="Loading…" />
          <main className="flex-1 space-y-4 p-4 lg:p-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[320px] w-full rounded-xl" />
              ))}
            </div>
          </main>
        </>
      }
    >
      <PropertiesPageContent />
    </Suspense>
  );
}
