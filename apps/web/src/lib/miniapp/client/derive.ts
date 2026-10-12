/**
 * Display derivations from /balances (+ /rates as a fallback): what one unit of each currency is
 * worth in micro-USD, totals in the display currency, and per-token autonomy limits from USD presets.
 */
import type { Sym } from "../contract";
import type { Balances, Rates } from "./api";
import { CUR_OF, DECIMALS, type Cur } from "./format";

/** micro-USD per 1 whole unit of each currency, when known. */
export type Prices = Partial<Record<Cur, bigint>>;

const MICRO = 1_000_000n;

function refRate(rates: Rates | null | undefined, pair: string): number | null {
  const r = rates?.references.find((x) => x.pair.toUpperCase() === pair);
  const n = r ? Number(r.rate) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function pricesFrom(balances: Balances | null | undefined, rates?: Rates | null): Prices {
  const p: Prices = { USD: MICRO };
  for (const b of balances?.balances ?? []) {
    const cur = CUR_OF[b.sym];
    if (cur === "USD" || p[cur]) continue;
    const amt = BigInt(b.amount);
    const usd = BigInt(balances?.usdMicros[b.sym] ?? "0");
    if (amt > 0n && usd > 0n) p[cur] = (usd * 10n ** BigInt(b.decimals)) / amt;
  }
  const usdArs = refRate(rates, "USD/ARS");
  if (!p.ARS && usdArs) p.ARS = BigInt(Math.round(1e6 / usdArs));
  const brlArs = refRate(rates, "BRL/ARS");
  if (!p.BRL && brlArs && p.ARS) p.BRL = BigInt(Math.round(Number(p.ARS) * brlArs));
  return p;
}

/** Converts micro-USD to an 18-decimal amount of `cur`; null when the price is unknown. */
export function usdToCur(usdMicros: bigint, cur: Cur, prices: Prices): bigint | null {
  const per = prices[cur];
  if (!per || per <= 0n) return null;
  return (usdMicros * 10n ** 18n) / per;
}

/** Total balance in the display currency (18 decimals), or null if it can't be priced. */
export function totalIn(balances: Balances, cur: Cur, prices: Prices): bigint | null {
  let micros = 0n;
  for (const b of balances.balances) micros += BigInt(balances.usdMicros[b.sym] ?? "0");
  return usdToCur(micros, cur, prices);
}

/** Per-currency balances (summing the dollar stables), atomic in each token's decimals normalised to 18. */
export function byCurrency(balances: Balances | null | undefined): Record<Cur, { amount18: bigint; usdMicros: bigint }> {
  const out: Record<Cur, { amount18: bigint; usdMicros: bigint }> = {
    ARS: { amount18: 0n, usdMicros: 0n },
    BRL: { amount18: 0n, usdMicros: 0n },
    USD: { amount18: 0n, usdMicros: 0n },
  };
  for (const b of balances?.balances ?? []) {
    const c = CUR_OF[b.sym];
    out[c].amount18 += BigInt(b.amount) * 10n ** BigInt(18 - b.decimals);
    out[c].usdMicros += BigInt(balances?.usdMicros[b.sym] ?? "0");
  }
  return out;
}

/** Atomic balance of a token (0 if absent). */
export function balanceOf(balances: Balances | null | undefined, sym: Sym): bigint {
  const b = balances?.balances.find((x) => x.sym === sym);
  return b ? BigInt(b.amount) : 0n;
}

/**
 * Autonomy limits for ArbolitoGuard v2 from a USD preset: the three dollars at face value, and
 * wARS/wBRL converted at the current price (omitted when no price is known).
 */
export function limitsFromUsd(perTxUsd: number, perDayUsd: number, prices: Prices): { sym: Sym; perTx: string; perDay: string }[] {
  const out: { sym: Sym; perTx: string; perDay: string }[] = [];
  const usd = (n: number) => BigInt(Math.round(n * 1e6));
  for (const sym of ["USDT", "USDC", "USAT"] as const) out.push({ sym, perTx: usd(perTxUsd).toString(), perDay: usd(perDayUsd).toString() });
  for (const sym of ["wARS", "wBRL"] as const) {
    const per = prices[CUR_OF[sym]];
    if (!per) continue;
    const toAtomic = (n: number) => ((usd(n) * 10n ** BigInt(DECIMALS[sym])) / per).toString();
    out.push({ sym, perTx: toAtomic(perTxUsd), perDay: toAtomic(perDayUsd) });
  }
  return out;
}
