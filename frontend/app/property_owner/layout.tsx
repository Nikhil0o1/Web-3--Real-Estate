"use client";

import { ReactNode } from "react";
import { RoleGate } from "@/components/auth/role-gate";
import { AdminSidebar } from "@/components/layout/sidebar";

export default function PropertyOwnerLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="property_owner">
      <div className="flex min-h-screen w-full">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </RoleGate>
  );
}
