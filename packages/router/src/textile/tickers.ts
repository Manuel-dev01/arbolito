import { z } from "zod";
import { loadEnv } from "@arbolito/config";

/**
 * Textile public tickers (no auth), CoinGecko-exchange style: GET {TEXTILE_PUBLIC_BASE}/tickers.
 * Shape per PLAN.md notes (ticker_id, bid, ask). Parsed defensively: if the live shape
 * differs, this returns null rather than guessing. Re-verify once the domain is reachable.
 */
const num = z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(z.number().finite());
const tickerSchema = z
  .object({
    ticker_id: z.string(),
    bid: num,
    ask: num,
    last_price: num.optional(),
    target_volume: num.optional(),
    base_volume: num.optional(),
  })
  .passthrough();

export interface TextileTicker {
  tickerId: string;
  base: string;
  target: string;
  bid: number;
  ask: number;
  mid: number;
}

export interface TickersResult {
  tickers: TextileTicker[];
  source: string;
  at: string;
}

export async function fetchTextileTickers(timeoutMs = 1500): Promise<TickersResult | null> {
  const url = `${loadEnv().TEXTILE_PUBLIC_BASE.replace(/\/$/, "")}/tickers`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const list = Array.isArray(body) ? body : (body as { tickers?: unknown })?.tickers;
    const parsed = z.array(tickerSchema).safeParse(list);
    if (!parsed.success) return null;
    const tickers = parsed.data
      .filter((t) => t.bid > 0 && t.ask > 0)
      .map((t) => {
        const [base = "", target = ""] = t.ticker_id.split("_");
        return { tickerId: t.ticker_id, base, target, bid: t.bid, ask: t.ask, mid: (t.bid + t.ask) / 2 };
      });
    return { tickers, source: url, at: new Date().toISOString() };
  } catch {
    return null;
  }
}
