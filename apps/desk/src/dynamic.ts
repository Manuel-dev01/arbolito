/**
 * Two parameters that used to be fixed now follow the market. Pure.
 *
 * 1. Carry-aware inventory target. Holding a currency that is losing value against the dollar
 *    costs money every day it sits in inventory. Each soft corridor measures its own carry (the
 *    trend of its fair price over the last week, robustly) and lowers the share of the corridor
 *    it aims to hold in that currency. The skew then leans the quotes toward that target. A
 *    corridor without enough history uses its prior (the peso's known crawl, ~5 bps/day).
 *
 * 2. Dispersion-scaled buy caps. The breaker stops quoting only once sources *disagree* (beyond
 *    maxDevBps). Before that point the sources are already drifting apart, which means fair is
 *    less certain. The buy-side cap shrinks with the (smoothed) dispersion, in quarter steps, so
 *    the desk accumulates less of a currency whose price it is less sure of. Only the buy side
 *    uses it: the rebalancer keeps the static cap, so a noisy hour never forces a sale.
 */
import type { Corridor } from "./corridors";

const DAY = 86_400_000;

export interface FairSample {
  at: number;
  /** Fiat units per 1 USD (e.g. 1660 ARS). */
  fiatPerUsd: number;
}

export interface CarryEstimate {
  /** Depreciation of the soft currency against USD, bps per day (positive = losing value). */
  bpsPerDay: number;
  source: "measured" | "prior";
  /** Daily points the measurement used (0 for the prior). */
  days: number;
}

/** Window, minimum span and the clamp on a measured carry (a one-day jump can't swing the target alone). */
export const CARRY_WINDOW_MS = 7 * DAY;
export const CARRY_MIN_DAYS = 3;
export const CARRY_MAX_BPS_PER_DAY = 25;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Carry from fair-price history: one median per UTC day (so tick noise and a brief dislocation
 * don't count), then the Theil–Sen slope of ln(fiat per USD) per day (the median of all pairwise
 * slopes, robust to an outlier day). Needs CARRY_MIN_DAYS distinct days, else the prior.
 */
export function estimateCarry(samples: readonly FairSample[], now: number, priorBpsPerDay = 0): CarryEstimate {
  const byDay = new Map<number, number[]>();
  for (const s of samples) {
    if (now - s.at > CARRY_WINDOW_MS || s.at > now || !(s.fiatPerUsd > 0)) continue;
    const d = Math.floor(s.at / DAY);
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(Math.log(s.fiatPerUsd));
  }
  const pts = [...byDay].map(([d, v]) => ({ d, y: median(v) })).sort((a, b) => a.d - b.d);
  if (pts.length < CARRY_MIN_DAYS) return { bpsPerDay: priorBpsPerDay, source: "prior", days: 0 };
  const slopes: number[] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) slopes.push((pts[j]!.y - pts[i]!.y) / (pts[j]!.d - pts[i]!.d));
  const bps = median(slopes) * 10_000;
  const clamped = Math.max(-CARRY_MAX_BPS_PER_DAY, Math.min(CARRY_MAX_BPS_PER_DAY, bps));
  return { bpsPerDay: Math.round(clamped * 100) / 100, source: "measured", days: pts.length };
}

/** Days of history at which a measurement gets full weight over the prior. */
export const CARRY_FULL_WEIGHT_DAYS = 14;

/**
 * The carry the target acts on: the measurement blended with the prior by how much history it
 * has (days / 14, so at most half after the one-week window). One week of FX is partly noise;
 * on 2026-10-27 raw week trends were wARS 25+, wBRL 20, wCOP 12, wMXN 8 bps/day.
 */
export function effectiveCarry(c: Pick<Corridor, "carry">, carry: CarryEstimate | undefined): number | undefined {
  if (!c.carry || !carry) return undefined;
  const w = carry.source === "measured" ? Math.min(1, carry.days / CARRY_FULL_WEIGHT_DAYS) : 0;
  return Math.round((w * carry.bpsPerDay + (1 - w) * c.carry.priorBpsPerDay) * 100) / 100;
}

/** The share of the corridor to hold in the soft asset, given its carry. Corridors without a carry setting keep their fixed target. */
export function carryTarget(c: Pick<Corridor, "skew" | "carry">, carry: CarryEstimate | undefined): number {
  const k = c.carry;
  const eff = effectiveCarry(c, carry);
  if (!k || eff === undefined) return c.skew.targetShare;
  const t = k.neutralShare - k.sharePerBpsDay * eff;
  return Math.round(Math.max(k.minShare, Math.min(k.maxShare, t)) * 1000) / 1000;
}

/** Below this fraction of the breaker's tolerance, dispersion is ordinary and the cap is whole. */
export const DISPERSION_FREE = 0.3;
/** At this fraction of the tolerance the cap is at its floor. */
export const DISPERSION_FULL = 0.9;
export const CAP_FLOOR = 0.25;

/**
 * Buy-cap multiplier from smoothed dispersion: 1 while sources sit within 30% of the breaker's
 * band, falling linearly to 0.25 at 90% of it. Rounded *down* to a quarter so the cap shrinks
 * conservatively and Stitch's config changes only at a few levels.
 */
export function capScale(dispersionBps: number | undefined, maxDevBps: number): number {
  if (dispersionBps === undefined || !(maxDevBps > 0)) return 1;
  const x = dispersionBps / maxDevBps;
  if (x <= DISPERSION_FREE) return 1;
  const raw = 1 - ((1 - CAP_FLOOR) * (x - DISPERSION_FREE)) / (DISPERSION_FULL - DISPERSION_FREE);
  return Math.max(CAP_FLOOR, Math.floor(raw * 4) / 4);
}

/** Smoothing for dispersion across ticks (10 s apart: about a 3-minute time constant). */
export const DISPERSION_ALPHA = 0.05;
export const smooth = (prev: number | undefined, x: number, alpha = DISPERSION_ALPHA) => (prev === undefined ? x : prev + alpha * (x - prev));
