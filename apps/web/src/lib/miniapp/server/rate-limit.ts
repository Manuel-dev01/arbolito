/**
 * In-memory fixed-window rate limiter (per function instance). Good enough to blunt abuse of the
 * paid LLM/STT path and code guessing on /link/confirm; not a global guarantee across instances.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Counts one hit; false when `key` already used `limit` hits in the current window. */
  take(key: string, limit: number, windowMs: number): boolean {
    const t = this.now();
    const cur = this.hits.get(key);
    if (!cur || t - cur.windowStart >= windowMs) {
      this.hits.set(key, { windowStart: t, count: 1 });
      this.sweep(t, windowMs);
      return true;
    }
    if (cur.count >= limit) return false;
    cur.count++;
    return true;
  }

  private sweep(t: number, windowMs: number) {
    if (this.hits.size < 5_000) return;
    for (const [k, v] of this.hits) if (t - v.windowStart >= windowMs) this.hits.delete(k);
  }
}
