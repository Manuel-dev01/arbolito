/**
 * Inventory caps. Stitch quotes each side up to its configured size on every RFQ, so a side that
 * keeps filling keeps accumulating (the desk bought US$ 40 of wBRL against a US$ 10 sell cap).
 * Past a corridor's maxSoftUsd the buy side is turned off; it comes back once holdings fall
 * below RESUME_RATIO of the cap (hysteresis, so it doesn't flap). Pure.
 */
import { TOKENS } from "@arbolito/config";
import type { Corridor } from "./corridors";
import type { Balances } from "./inventory";

export const RESUME_RATIO = 0.8;

/** USD value of a corridor's soft holdings at fair (USDT per soft), or undefined without a fair price. */
export function softUsd(b: Balances, c: Corridor, usdtPerSoft: number | undefined): number | undefined {
  if (usdtPerSoft === undefined) return undefined;
  return (Number(b[c.soft]) / 10 ** TOKENS[c.soft].decimals) * usdtPerSoft;
}

/** Live corridors whose buy side should be off. Without a fair price a corridor keeps its previous state. */
export function buySidesOff(b: Balances, corridors: readonly Corridor[], usdtPerSoft: Record<string, number | undefined>, prev: ReadonlySet<string>): Set<string> {
  const off = new Set<string>();
  for (const c of corridors) {
    if (!c.live) continue;
    const v = softUsd(b, c, usdtPerSoft[c.pair]);
    if (v === undefined) {
      if (prev.has(c.pair)) off.add(c.pair);
      continue;
    }
    if (v >= c.maxSoftUsd || (prev.has(c.pair) && v > c.maxSoftUsd * RESUME_RATIO)) off.add(c.pair);
  }
  return off;
}
