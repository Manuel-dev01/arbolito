"use client";
/**
 * Scroll driver for the landing's story: writes the section's scroll progress (0..1) to --p, and
 * the CSS does the rest. Without JS, or with prefers-reduced-motion, data-live is never set and
 * the story renders as a static, fully readable layout.
 */
import { useEffect, useRef, type ReactNode } from "react";

export function StoryScroll({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.live = "1";
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 1;
      el.style.setProperty("--p", p.toFixed(4));
      // The closing beat (with its links) only takes clicks once it is on screen.
      if (p > 0.62) el.dataset.end = "1";
      else delete el.dataset.end;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      delete el.dataset.live;
      delete el.dataset.end;
    };
  }, []);
  return (
    <section ref={ref} id="historia" className="story" aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}
