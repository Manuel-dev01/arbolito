"use client";
/**
 * Mount point for the landing's 3D coins (see coins-scene.ts). A fixed, full-viewport canvas
 * behind the content; three.js loads after hydration so it never delays first paint. With
 * prefers-reduced-motion the coins still follow the sections, but without spin or easing.
 */
import { useEffect, useRef } from "react";

export function Coin() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let handle: { dispose(): void } | null = null;
    let cancelled = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void Promise.all([import("./coins-scene"), document.fonts?.ready]).then(([m]) => {
      if (cancelled) return;
      handle = m.mountCoins(canvas, { reducedMotion });
      if (handle) canvas.dataset.ready = "1";
    });
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, []);
  return <canvas ref={ref} className="coin-canvas" aria-hidden="true" />;
}
