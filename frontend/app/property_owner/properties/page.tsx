"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { AdminTopbar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CreatePropertyDialog } from "@/components/properties/create-property-dialog";
import { MintNftDialog } from "@/components/properties/mint-nft-dialog";
import { PropertyCard } from "@/components/properties/property-card";
import { EditPropertyDialogHost } from "@/components/properties/edit-property-dialog";
import { EmptyState } from "@/components/common/empty";
import { useProperties } from "@/lib/queries";

export default function PropertiesPage() {
  const properties = useProperties();
  const [search, setSearch] = useState("");

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
      <AdminTopbar title="Properties" subtitle="Manage your property catalog and on-chain tokens" />
      <main className="flex-1 space-y-4 p-4 lg:p-6">
        <PageHeader
          title="Properties"
          description="Create, deploy and manage tokenized real estate."
          actions={
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search properties…"
                  className="h-9 w-64 pl-8 text-sm"
                />
              </div>
              <MintNftDialog properties={properties.data ?? []} />
              <CreatePropertyDialog />
            </>
          }
        />

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
          <motion.div
            layout
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
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
