"use client";

import { useEffect, useState } from "react";

/** Respects `prefers-reduced-motion` for Framer Motion `transition` overrides. */
export function useReducedMotionFlag(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function springTransition(reduced: boolean) {
  if (reduced) return { duration: 0.01 };
  return { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.85 };
}

export const listItemVariants = {
  hidden: { opacity: 0, y: 6 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: Math.min(i * 0.035, 0.14), duration: 0.2, ease: [0.22, 1, 0.36, 1] as const },
  }),
  exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
};
