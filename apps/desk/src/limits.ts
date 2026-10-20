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

/** Buy-side sizes move in these steps, so Stitch restarts only when a step changes. */
export const BUY_STEP_USD = 5;

/**
 * How much USDT each live corridor may offer on its buy side: its fixed buyCapUsdt, cut to the
 * room left under maxSoftUsd, in BUY_STEP_USD steps. Without this, a corridor reopening just
 * under its resume level offered its full size and one fill overshot the cap again (2026-10-20:
 * US$ 20 of wBRL bought at US$ 17.6 held, cap US$ 25), which the rebalancer then sold back a few
 * bps under fair. Growing a step needs US$ 1 of extra room (hysteresis against price noise);
 * shrinking is immediate. A corridor without a fair price keeps its previous size. Pure.
 */
export function buySizes(b: Balances, corridors: readonly Corridor[], usdtPerSoft: Record<string, number | undefined>, prev: ReadonlyMap<string, bigint>): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const step = BigInt(BUY_STEP_USD) * 1_000_000n;
  for (const c of corridors) {
    if (!c.live) continue;
    const held = softUsd(b, c, usdtPerSoft[c.pair]);
    if (held === undefined) {
      out.set(c.pair, prev.get(c.pair) ?? c.buyCapUsdt);
      continue;
    }
    const room = c.maxSoftUsd - held;
    const steps = (r: number) => BigInt(Math.max(0, Math.floor(r / BUY_STEP_USD))) * step;
    const cap = (v: bigint) => (v < c.buyCapUsdt ? v : c.buyCapUsdt);
    const now = cap(steps(room));
    const before = prev.get(c.pair);
    // Grow only with a dollar to spare past the step; shrink at once.
    out.set(c.pair, before !== undefined && now > before && cap(steps(room - 1)) <= before ? before : now);
  }
  return out;
}
