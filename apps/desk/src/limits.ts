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
/** Room within this much of a step counts as the step: a cap is a limit, not to the cent. */
const ROOM_TOLERANCE_USD = 1;

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
    // A corridor holding US$ 10.01 under a US$ 15 cap still offers US$ 5 (US$ 4.99 of room).
    const steps = (r: number) => BigInt(Math.max(0, Math.floor((r + ROOM_TOLERANCE_USD) / BUY_STEP_USD))) * step;
    const cap = (v: bigint) => (v < c.buyCapUsdt ? v : c.buyCapUsdt);
    const now = cap(steps(room));
    const before = prev.get(c.pair);
    // Grow only with a dollar to spare past the step; shrink at once.
    out.set(c.pair, before !== undefined && now > before && cap(steps(room - 1)) <= before ? before : now);
  }
  return out;
}

/** How long a looser buy setting (a bigger size, a side back on) must hold before Stitch gets it. */
export const LOOSEN_HOLD_MS = 15 * 60_000;

/**
 * Tighten at once, loosen slowly. Every change to Stitch's config restarts it, and the inputs
 * (fair price, the dispersion-scaled cap) wobble across step boundaries: in the week to
 * 2026-11-22 Stitch restarted ~40 times a day, up to once a minute, mostly for buy sizes that
 * shrank and grew back. A smaller size or a side switched off is safety, so it applies on the
 * tick it is proposed. A larger size or a side switched back on applies only after it has been
 * proposed continuously for holdMs; any tick that proposes less starts the wait over.
 */
export class LoosenGate {
  private off = new Set<string>();
  private sizes = new Map<string, bigint>();
  private since = new Map<string, number>();
  private started = false;

  constructor(private holdMs = LOOSEN_HOLD_MS) {}

  apply(proposedOff: ReadonlySet<string>, proposedSizes: ReadonlyMap<string, bigint>, now: number): { buyOff: Set<string>; buySize: Map<string, bigint> } {
    // First call: nothing is applied yet, so the proposal is the starting point.
    if (!this.started) {
      this.started = true;
      this.off = new Set(proposedOff);
      this.sizes = new Map(proposedSizes);
      return this.current();
    }
    const waited = (key: string, looser: boolean) => {
      if (!looser) {
        this.since.delete(key);
        return false;
      }
      const t = this.since.get(key) ?? this.since.set(key, now).get(key)!;
      if (now - t < this.holdMs) return false;
      this.since.delete(key);
      return true;
    };
    for (const p of new Set([...this.off, ...proposedOff])) {
      if (proposedOff.has(p)) this.off.add(p);
      if (waited(`off:${p}`, this.off.has(p) && !proposedOff.has(p))) this.off.delete(p);
    }
    for (const [p, v] of proposedSizes) {
      const applied = this.sizes.get(p);
      if (applied === undefined || v < applied) this.sizes.set(p, v);
      if (waited(`size:${p}`, applied !== undefined && v > applied)) this.sizes.set(p, v);
    }
    return this.current();
  }

  /** Loosenings waiting out their hold: key → ms epoch the wait started. */
  pending(): Record<string, string> {
    return Object.fromEntries([...this.since].map(([k, t]) => [k, new Date(t).toISOString()]));
  }

  private current() {
    return { buyOff: new Set(this.off), buySize: new Map(this.sizes) };
  }
}
