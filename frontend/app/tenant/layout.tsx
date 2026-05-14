"use client";

import { ReactNode } from "react";
import { RoleGate } from "@/components/auth/role-gate";
import { TenantSidebar } from "@/components/tenant/tenant-sidebar";
import { TenantAiRuntime } from "@/components/tenant/ai/tenant-ai-runtime";

export default function TenantLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="tenant">
      <TenantAiRuntime />
      <div className="relative flex min-h-screen w-full bg-background">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.12]" aria-hidden />
        <TenantSidebar />
        <div className="relative flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </RoleGate>
  );
}
