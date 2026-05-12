"use client";

import { ReactNode } from "react";
import { RoleGate } from "@/components/auth/role-gate";
import { InvestorSidebar } from "@/components/investor/investor-sidebar";

export default function InvestorLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="investor">
      <div className="flex min-h-screen w-full">
        <InvestorSidebar />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </RoleGate>
  );
}
