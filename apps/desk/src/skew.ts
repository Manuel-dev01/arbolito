/**
 * Inventory skew. Stitch's own inventory lean doesn't reach RFQ quotes, so the desk leans the
 * mid it publishes instead: long the soft asset → mid shaded down (we sell it more readily and
 * buy less); short → shaded up. Each direction is capped by the spread on the side it moves
 * toward fair, minus the floor: shading down moves the ask toward fair, so it is capped by
 * sellOffset − floor; shading up moves the bid toward fair, capped by buyOffset − floor.
 * No quote ever crosses fair. Pure.
 */
import type { Corridor } from "./corridors";

/** Share of the corridor's value held in the soft asset (0 = all USDT, 1 = all soft). */
export function inventoryShare(softUsd: number, usdtUsd: number): number | undefined {
  const total = softUsd + usdtUsd;
  if (!(total > 0)) return undefined;
  return softUsd / total;
}

/** Mid shift in bps: negative when long the soft asset. 0 when inventory is unknown. */
export function skewBps(share: number | undefined, c: Pick<Corridor, "skew" | "buyOffsetBps" | "sellOffsetBps">): number {
  if (share === undefined) return 0;
  const s = c.skew;
  const d = Math.max(-1, Math.min(1, (share - s.targetShare) / s.bandShare));
  const raw = -d * s.maxBps;
  const down = Math.max(0, c.sellOffsetBps - s.floorBps);
  const up = Math.max(0, c.buyOffsetBps - s.floorBps);
  const capped = Math.max(-down, Math.min(up, raw));
  return Math.round(capped * 100) / 100 + 0; // + 0 turns -0 into 0
}

/** The price Stitch reads: USDT per 1 soft unit (debt per collateral), skew applied. */
export function publishedPrice(fiatPerUsd: number, skew: number): number {
  return (1 / fiatPerUsd) * (1 + skew / 10_000);
}
