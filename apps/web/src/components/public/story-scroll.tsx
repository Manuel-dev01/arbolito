"use client";
/**
 * Scroll driver for the landing's story ("Un día en la esquina"). It writes the section's scroll
 * progress (0..1) to --p and the canvas fit scale to --s; the CSS does the motion. It also runs the
 * two things CSS can't: the street clock (08:00 → 19:00 → 06:00 → 08:00) and the peso count.
 * Without JS, or with prefers-reduced-motion, data-live is never set and the static layout shows.
 */
import { useEffect, useRef, type ReactNode } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/** The spec's day: morning to dusk over .24, the night to .88, dawn to the end. */
export function clockAt(p: number): string {
  let h = p < 0.24 ? 8 + (p / 0.24) * 11 : p < 0.88 ? 19 + ((p - 0.24) / 0.64) * 11 : 6 + ((p - 0.88) / 0.12) * 2;
  h %= 24;
  const H = Math.floor(h);
  return `${pad(H)}:${pad(Math.floor((h - H) * 60))}`;
}

/** Pesos counted for US$ 100 at the receipt's rate, over the count beat (.36 → .54). */
export function pesosAt(p: number): number {
  return Math.round(162186 * Math.min(1, Math.max(0, (p - 0.36) / 0.18)));
}

export function StoryScroll({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.live = "1";
    const stage = el.querySelector<HTMLElement>(".os-stage");
    const clock = el.querySelector<HTMLElement>("[data-os-clock]");
    const pesos = el.querySelector<HTMLElement>("[data-os-pesos]");
    const bills = el.querySelector<HTMLElement>("[data-os-bills]");
    const ars = new Intl.NumberFormat("es-AR");
    let frame = 0;
    let last = -1;
    const fit = () => {
      if (!stage) return;
      // The canvas is drawn at its breakpoint's design size (--W × --H) and scaled to fit the viewport.
      const cs = getComputedStyle(stage);
      const w = Number(cs.getPropertyValue("--W")) || 1440;
      const h = Number(cs.getPropertyValue("--H")) || 900;
      const nav = parseFloat(cs.getPropertyValue("--navh")) || 0;
      stage.style.setProperty("--s", Math.min(window.innerWidth / w, (window.innerHeight - nav) / h).toFixed(4));
    };
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 1;
      if (p === last) return;
      last = p;
      el.style.setProperty("--p", p.toFixed(4));
      // Links (card, bar, receipt) take clicks only once the closing beat is on screen.
      if (p > 0.8) el.dataset.end = "1";
      else delete el.dataset.end;
      if (clock) clock.textContent = clockAt(p);
      const v = pesosAt(p);
      if (pesos) pesos.textContent = ars.format(v);
      if (bills) bills.textContent = ars.format(Math.ceil(v / 100));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onResize = () => {
      fit();
      last = -1;
      onScroll();
    };
    // Keyboard users: the links live in the closing beat, so focusing one brings that beat on screen.
    const onFocus = (e: FocusEvent) => {
      if (!(e.target instanceof HTMLElement) || !e.target.closest(".os-card, .os-ctas-bar, .os-receipt")) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + (el.offsetHeight - window.innerHeight) * 0.92 });
    };
    fit();
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    el.addEventListener("focusin", onFocus);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      el.removeEventListener("focusin", onFocus);
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
