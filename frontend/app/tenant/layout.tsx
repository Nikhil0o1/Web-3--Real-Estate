"use client";

import { ReactNode } from "react";
import { RoleGate } from "@/components/auth/role-gate";
import { TenantSidebar } from "@/components/tenant/tenant-sidebar";

export default function TenantLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="tenant">
      <div className="flex min-h-screen w-full">
        <TenantSidebar />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </RoleGate>
  );
}
