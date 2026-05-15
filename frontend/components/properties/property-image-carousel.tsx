"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pickColor } from "@/lib/charts";

type PropertyImageCarouselProps = {
  images?: string[];
  propertyId: number;
  title: string;
  className?: string;
  children?: React.ReactNode;
};

export function PropertyImageCarousel({
  images,
  propertyId,
  title,
  className,
  children,
}: PropertyImageCarouselProps) {
  const safeImages = (images ?? []).filter(Boolean);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = safeImages[index] ?? null;
  const hasMultiple = safeImages.length > 1;

  useEffect(() => {
    setIndex(0);
  }, [propertyId, safeImages.length]);

  useEffect(() => {
    if (!hasMultiple || paused) return;
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % safeImages.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [hasMultiple, paused, safeImages.length]);

  function go(delta: number) {
    setIndex((value) => (value + delta + safeImages.length) % safeImages.length);
  }

  return (
    <motion.div
      className={cn("relative h-36 overflow-hidden", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={
        current
          ? undefined
          : { background: `linear-gradient(135deg, ${pickColor(propertyId)} 0%, hsl(var(--card)) 100%)` }
      }
    >
      {current ? (
        <img
          key={current}
          src={current}
          alt={title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-card via-card/45 to-transparent" />

      {hasMultiple ? (
        <>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute left-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-background/80"
            onClick={(event) => {
              event.stopPropagation();
              go(-1);
            }}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full bg-background/80"
            onClick={(event) => {
              event.stopPropagation();
              go(1);
            }}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <div className="absolute bottom-2 right-3 flex gap-1">
            {safeImages.map((_, dotIndex) => (
              <span
                key={dotIndex}
                className={cn(
                  "h-1.5 rounded-full bg-white/60 transition-all",
                  dotIndex === index ? "w-4 bg-white" : "w-1.5",
                )}
              />
            ))}
          </div>
        </>
      ) : null}

      {children}
    </motion.div>
  );
}
