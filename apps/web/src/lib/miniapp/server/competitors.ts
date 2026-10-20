import { latestCompetitorRates, type Db } from "@arbolito/db";
import type { Reference } from "@arbolito/router";
import type { Sym } from "../contract";

/** Western Union readings older than this aren't shown (the runner refreshes them every 6 h). */
export const WU_MAX_AGE_MS = 24 * 3_600_000;

const FIAT: Partial<Record<Sym, "ARS" | "BRL">> = { wARS: "ARS", wBRL: "BRL" };
const USD: ReadonlySet<Sym> = new Set(["USDT", "USDC", "USAT"]);

/**
 * The latest Western Union readings as references (USD/ARS, USD/BRL). Their source names the
 * page and the buy payment that paid for the browser that read it, so a receipt that cites
 * one shows where the number came from.
 */
export async function westernUnionReferences(db: Db | null | undefined, now = Date.now()): Promise<Reference[]> {
  if (!db) return [];
  const rows = await latestCompetitorRates(db, "western_union", WU_MAX_AGE_MS, now);
  return rows.map((r) => ({
    name: "western_union",
    pair: `USD/${r.corridor.split("-")[1]}`,
    rate: r.rate,
    source: `${r.sourceUrl} (read in a browser bought through buy${r.paymentTx ? `, x402 payment ${r.paymentTx}` : ""})`,
    at: r.at.toISOString(),
  }));
}

/** "1618.75" → 1618.75e18 as a bigint (18 decimals). */
function fixed18(s: string): bigint {
  const [i = "0", f = ""] = s.split(".");
  return BigInt(i) * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18) || "0");
}

/**
 * How a dollar → peso/real conversion compares with Western Union's rate (before its fee):
 * the % more local currency Arbolito delivered, and how much more in the token's atomic units.
 * Null for other directions (Western Union's converter quotes dollars → local only) or without a reading.
 */
export function vsWesternUnion(
  from: Sym,
  to: Sym,
  amountIn: bigint,
  amountOut: bigint,
  refs: readonly { name: string; pair: string; rate: string; at: string }[],
): { pct: number; rate: string; deltaOut: string; at: string } | null {
  const fiat = FIAT[to];
  if (!fiat || !USD.has(from) || amountIn <= 0n) return null;
  const ref = refs.find((r) => r.name === "western_union" && r.pair === `USD/${fiat}`);
  if (!ref) return null;
  // amountIn has 6 decimals, the rate 18, the output 18: amountIn × rate / 1e6.
  const theirs = (amountIn * fixed18(ref.rate)) / 1_000_000n;
  if (theirs <= 0n) return null;
  return { pct: Number(((amountOut - theirs) * 10_000n) / theirs) / 100, rate: ref.rate, deltaOut: (amountOut - theirs).toString(), at: ref.at };
}
