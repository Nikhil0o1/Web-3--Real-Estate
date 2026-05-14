"use client";

import { ReactNode } from "react";
import { RoleGate } from "@/components/auth/role-gate";
import { AdminSidebar } from "@/components/layout/sidebar";
import { PropertyOwnerAiRuntime } from "@/components/property_owner/ai/property-owner-ai-runtime";

export default function PropertyOwnerLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="property_owner">
      <PropertyOwnerAiRuntime />
      <div className="relative flex min-h-screen w-full bg-background">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.14]" aria-hidden />
        <div className="ambient-edge pointer-events-none absolute inset-x-0 top-0 h-48 opacity-70" aria-hidden />
        <AdminSidebar />
        <div className="relative flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </RoleGate>
  );
}
