"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { WalletPill } from "./wallet-pill";
import { StatusDot } from "./status-dot";

export function AdminTopbar({
  title,
  subtitle,
  onMenuClick,
}: {
  title: string;
  subtitle?: string;
  onMenuClick?: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="flex flex-col leading-tight">
          <h1 className="text-base font-semibold tracking-tight md:text-lg">{title}</h1>
          {subtitle ? <span className="text-xs text-muted-foreground">{subtitle}</span> : null}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <WalletPill />
        <ThemeToggle />
        <StatusDot />
      </div>
    </header>
  );
}
