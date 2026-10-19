/**
 * The rebalancer's decision (pure). The inventory cap (limits.ts) only stops the desk buying more
 * of a soft asset; the excess then sits idle and the buy side stays off. This sells the excess back
 * to USDT, a slice at a time, until the corridor is below the level where its buy side resumes.
 *
 * Rules:
 * - Only a corridor whose buy side is off (it hit its cap) and is still above RESUME_RATIO of it.
 * - Sell down to TARGET_RATIO of the cap (below RESUME_RATIO, so the buy side comes back).
 * - One slice per decision, at most MAX_SLICE_USD (inside the US$ 5 per-action cap), and never
 *   below the corridor's RFQ sell size (Stitch keeps that much on offer).
 * - A floor price: the route must pay at least fair minus maxUnderFairBps, or the desk holds.
 * - A cooldown per corridor between slices.
 */
import { TOKENS } from "@arbolito/config";
import type { Corridor } from "./corridors";
import type { Balances } from "./inventory";
import { RESUME_RATIO, softUsd } from "./limits";

export const REBALANCE = {
  targetRatio: 0.7,
  maxSliceUsd: 5,
  minSliceUsd: 1,
  cooldownMs: 10 * 60_000,
  /** Worst accepted price under fair: wFIAT pools are thin, stables should trade at the peg. */
  maxUnderFairBps: { wfiat: 40, stable: 10 },
  /** A Textile route is allowed only once the buy side has been off this long (our maker then can't fill it). */
  textileAfterOffMs: 5 * 60_000,
} as const;

export interface SellSlice {
  pair: Corridor["pair"];
  soft: Corridor["soft"];
  /** Soft amount to sell (atomic). */
  amount: bigint;
  /** Its value at fair, US$. */
  usd: number;
  /** Fair, USDT per soft. */
  fair: number;
  /** Minimum USDT out (atomic) at the floor price. */
  minUsdtOut: bigint;
  maxUnderFairBps: number;
}

const isStable = (c: Corridor) => c.fiat === "USD";

/** Converts a US$ value at `fair` (USDT per soft) to an atomic soft amount. */
function softAtomic(usd: number, fair: number, decimals: number): bigint {
  const units = usd / fair;
  return BigInt(Math.floor(units * 1e6)) * 10n ** BigInt(decimals) / 1_000_000n;
}

/**
 * The next slice to sell, or null. Picks the corridor furthest over its target. `lastSellAt` is
 * the time of each corridor's last slice; `buyOff` are corridors whose buy side is off now.
 */
export function nextSlice(
  b: Balances,
  corridors: readonly Corridor[],
  usdtPerSoft: Record<string, number | undefined>,
  buyOff: ReadonlySet<string>,
  lastSellAt: ReadonlyMap<string, number>,
  now: number,
): SellSlice | null {
  let best: { c: Corridor; excess: number; fair: number } | null = null;
  for (const c of corridors) {
    if (!c.live || !buyOff.has(c.pair)) continue;
    const fair = usdtPerSoft[c.pair];
    const v = softUsd(b, c, fair);
    if (fair === undefined || v === undefined || v <= c.maxSoftUsd * RESUME_RATIO) continue;
    if (now - (lastSellAt.get(c.pair) ?? 0) < REBALANCE.cooldownMs) continue;
    const excess = v - c.maxSoftUsd * REBALANCE.targetRatio;
    if (!best || excess > best.excess) best = { c, excess, fair };
  }
  if (!best) return null;
  const { c, fair } = best;
  const decimals = TOKENS[c.soft].decimals;
  let amount = softAtomic(Math.min(best.excess, REBALANCE.maxSliceUsd), fair, decimals);
  // Keep the RFQ sell size on hand: Stitch offers it on every RFQ.
  const sellable = b[c.soft] > c.sellCapSoft ? b[c.soft] - c.sellCapSoft : 0n;
  if (amount > sellable) amount = sellable;
  const usd = (Number(amount) / 10 ** decimals) * fair;
  if (usd < REBALANCE.minSliceUsd) return null;
  const maxUnderFairBps = isStable(c) ? REBALANCE.maxUnderFairBps.stable : REBALANCE.maxUnderFairBps.wfiat;
  // floor = amount × fair × (1 − bps), in USDT atomic (6 decimals), rounded up.
  const fairMicros = BigInt(Math.round(fair * 1e12)); // USDT-micro per soft unit, ×1e6 for precision
  const atFair = (amount * fairMicros) / 10n ** BigInt(decimals) / 1_000_000n;
  const minUsdtOut = (atFair * BigInt(10_000 - maxUnderFairBps) + 9_999n) / 10_000n;
  return { pair: c.pair, soft: c.soft, amount, usd, fair, minUsdtOut, maxUnderFairBps };
}
