/**
 * Quote countdown. The bar and timer turn pink in the last 10 seconds; at zero the card dims and
 * the action becomes "Pedir nueva cotización".
 */
export type CountdownPhase = "normal" | "low" | "expired";

export const LOW_SECONDS = 10;

export interface Countdown {
  /** Whole seconds left, rounded up, never negative. */
  secs: number;
  phase: CountdownPhase;
  /** Bar width 0..1 relative to the quote's full validity window. */
  fraction: number;
}

/**
 * @param expiresAtMs quote expiry (epoch ms)
 * @param nowMs current time (epoch ms)
 * @param totalMs the quote's full validity window (expiry − time received); falls back to 48 s.
 */
export function countdown(expiresAtMs: number, nowMs: number, totalMs = 48_000): Countdown {
  const leftMs = expiresAtMs - nowMs;
  const secs = Math.max(0, Math.ceil(leftMs / 1000));
  const phase: CountdownPhase = secs <= 0 ? "expired" : secs <= LOW_SECONDS ? "low" : "normal";
  const total = totalMs > 0 ? totalMs : 48_000;
  const fraction = phase === "expired" ? 0 : Math.max(0, Math.min(1, leftMs / total));
  return { secs, phase, fraction };
}
