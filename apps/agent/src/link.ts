/**
 * "Conectá tu MiniPay": a 4-digit code the bot shows and the mini app confirms (same code in
 * both apps, so a stolen Telegram session can't link someone else's wallet). The web backend
 * marks the code used and sets users.wallet_address; the bot polls for that.
 */
import { randomInt } from "node:crypto";

export const LINK_CODE_TTL_MS = 10 * 60_000;
export const LINK_POLL_MS = 3_000;

/** Uniform in [min, max), from a CSPRNG by default. Injectable for tests. */
export type RandomInt = (min: number, max: number) => number;

/** A crypto-random 4-digit code, "0000" to "9999". */
export function generateLinkCode(rand: RandomInt = randomInt): string {
  const n = rand(0, 10_000);
  if (!Number.isInteger(n) || n < 0 || n >= 10_000) throw new RangeError("random source out of range");
  return String(n).padStart(4, "0");
}

export const linkCodeExpiry = (now: number) => new Date(now + LINK_CODE_TTL_MS);

export interface PollOptions {
  intervalMs: number;
  /** Epoch ms; polling stops once reached and `onTimeout` runs. */
  deadline: number;
  now?: () => number;
  /** Return true when done (stops polling). Errors are reported and polling continues. */
  check: () => Promise<boolean>;
  onTimeout: () => Promise<void> | void;
  onError?: (err: unknown) => void;
}

/** Polls `check` every `intervalMs` until it returns true or `deadline` passes. Returns a cancel function. */
export function pollUntil(o: PollOptions): () => void {
  const now = o.now ?? Date.now;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    try {
      if (await o.check()) {
        stopped = true;
        return;
      }
    } catch (err) {
      o.onError?.(err);
    }
    if (stopped) return;
    if (now() >= o.deadline) {
      stopped = true;
      try {
        await o.onTimeout();
      } catch (err) {
        o.onError?.(err);
      }
      return;
    }
    timer = setTimeout(tick, Math.min(o.intervalMs, Math.max(0, o.deadline - now())));
  };
  timer = setTimeout(tick, o.intervalMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
