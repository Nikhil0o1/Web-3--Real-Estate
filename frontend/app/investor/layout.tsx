"use client";

import { ReactNode } from "react";
import { RoleGate } from "@/components/auth/role-gate";
import { InvestorSidebar } from "@/components/investor/investor-sidebar";
import { AiCommandPalette } from "@/components/investor/ai/ai-command-palette";
import { InvestorAiRuntime } from "@/components/investor/ai/investor-ai-runtime";

export default function InvestorLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="investor">
      <InvestorAiRuntime />
      <AiCommandPalette />
      <div className="relative flex min-h-screen w-full bg-background">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.12]" aria-hidden />
        <InvestorSidebar />
        <div className="relative flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </RoleGate>
  );
}
