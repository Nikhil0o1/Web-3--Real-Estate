"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type WaveformProps = {
  analyser: AnalyserNode | null;
  active: boolean;
  bars?: number;
  className?: string;
  /** Visual tint mode — listening = emerald, speaking = violet, idle = muted. */
  mode?: "listening" | "speaking" | "idle";
};

export function Waveform({ analyser, active, bars = 28, className, mode = "idle" }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const ctx = canvas.getContext("2d");
    if (!ctx) return () => observer.disconnect();

    const tint =
      mode === "speaking"
        ? "rgba(167, 139, 250, 0.95)"
        : mode === "listening"
          ? "rgba(52, 211, 153, 0.95)"
          : "rgba(148, 163, 184, 0.6)";

    const buf = new Uint8Array(analyser?.frequencyBinCount || 0);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);

      let levels: number[];
      if (active && analyser) {
        analyser.getByteFrequencyData(buf);
        const step = Math.max(1, Math.floor(buf.length / bars));
        levels = new Array(bars).fill(0);
        for (let i = 0; i < bars; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += buf[i * step + j] || 0;
          levels[i] = sum / step / 255;
        }
      } else {
        // Idle: low-amplitude resting wave so the UI doesn't look frozen.
        const t = performance.now() / 600;
        levels = Array.from({ length: bars }, (_, i) => 0.08 + Math.sin(t + i * 0.4) * 0.04);
      }

      const barWidth = w / bars;
      const gap = barWidth * 0.35;
      for (let i = 0; i < bars; i++) {
        const amp = Math.max(0.05, Math.min(1, levels[i] * 1.4));
        const barHeight = amp * h * 0.9;
        const x = i * barWidth + gap / 2;
        const y = (h - barHeight) / 2;
        ctx.fillStyle = tint;
        const radius = Math.min((barWidth - gap) / 2, barHeight / 2, 6);
        roundRect(ctx, x, y, barWidth - gap, barHeight, radius);
        ctx.fill();
      }
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser, active, bars, mode]);

  return <canvas ref={canvasRef} className={cn("block h-8 w-full", className)} aria-hidden />;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
