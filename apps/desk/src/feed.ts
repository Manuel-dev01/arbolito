/**
 * The feed's state machine, one step per tick per corridor. Pure.
 *
 * Publish: a fresh `{price, timestamp}` from the fair value and the inventory skew.
 * Hold (the circuit breaker): keep serving the last good price with its OLD timestamp, so it
 * ages past Stitch's `staleness_secs` and Stitch stops quoting. We hold when sources are stale or
 * disagree, and when the fair value jumps more than `jumpBps` in one tick until the new level has
 * persisted for `jumpConfirmMs` (a glitch never gets quoted; a real move does, a little later).
 */
import type { Corridor } from "./corridors";
import { devBps, type Dropped, type Fair } from "./fair";
import { publishedPrice, skewBps } from "./skew";

export interface Published {
  /** USDT per 1 soft unit (Stitch's "debt per collateral"). */
  price: number;
  /** Unix seconds of the last healthy computation. */
  timestamp: number;
}

export interface FeedState {
  lastGood?: Published & { fiatPerUsd: number };
  /** A large move waiting to be confirmed. */
  pending?: { fiatPerUsd: number; since: number };
}

export interface Decision {
  pair: string;
  at: string;
  action: "publish" | "hold";
  reason?: string;
  fiatPerUsd?: number;
  share?: number;
  skewBps?: number;
  price?: number;
  used: string[];
  dropped: Dropped[];
  dispersionBps?: number;
}

export interface StepResult {
  state: FeedState;
  /** What the feed serves now (undefined before the first healthy tick). */
  served?: Published;
  decision: Decision;
}

export function step(c: Corridor, state: FeedState, fair: Fair, share: number | undefined, now: number): StepResult {
  const base = { pair: c.pair, at: new Date(now).toISOString(), used: fair.used, dropped: fair.dropped };
  const hold = (reason: string, next: FeedState, extra: Partial<Decision> = {}): StepResult => ({
    state: next,
    served: next.lastGood && { price: next.lastGood.price, timestamp: next.lastGood.timestamp },
    decision: { ...base, ...extra, action: "hold", reason },
  });

  if (!fair.ok) return hold(fair.reason, { ...state });

  const f = fair.fiatPerUsd;
  const prev = state.lastGood?.fiatPerUsd;
  let pending = state.pending;
  if (prev !== undefined && devBps(f, prev) > c.jumpBps) {
    const consistent = pending !== undefined && devBps(f, pending.fiatPerUsd) <= c.jumpBps / 4;
    if (!consistent) return hold(`jump ${Math.round(devBps(f, prev))} bps: confirming`, { ...state, pending: { fiatPerUsd: f, since: now } }, { fiatPerUsd: f });
    if (now - pending!.since < c.jumpConfirmMs) return hold(`jump ${Math.round(devBps(f, prev))} bps: confirming`, { ...state }, { fiatPerUsd: f });
  }
  pending = undefined;

  const skew = skewBps(share, c);
  const price = publishedPrice(f, skew);
  const lastGood = { price, timestamp: Math.floor(now / 1000), fiatPerUsd: f };
  return {
    state: { lastGood, pending },
    served: { price, timestamp: lastGood.timestamp },
    decision: { ...base, action: "publish", fiatPerUsd: f, share, skewBps: skew, price, dispersionBps: fair.dispersionBps },
  };
}
