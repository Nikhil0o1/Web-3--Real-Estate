"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted ? resolvedTheme === "dark" : true;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle theme"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative inline-flex h-7 w-12 items-center rounded-full border border-border bg-muted/60 transition-colors hover:bg-muted",
        className,
      )}
    >
      <Sun className="absolute left-1.5 h-3.5 w-3.5 text-warning" />
      <Moon className="absolute right-1.5 h-3.5 w-3.5 text-foreground/80" />
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className={cn(
          "z-10 inline-block h-5 w-5 rounded-full bg-background shadow-md ring-1 ring-border",
          isDark ? "translate-x-[26px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
}
