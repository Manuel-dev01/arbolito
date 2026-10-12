import { unstable_cache } from "next/cache";
import { cache } from "react";
import { createPublicClient, http, type PublicClient } from "viem";
import { celo } from "viem/chains";
import { fetchReferences } from "@arbolito/router";
import type { ProofBundle } from "@arbolito/proof";
import { resolveRate, type ReferenceName } from "../../lib/receipt-view";

/**
 * Live reference rates for the landing (server only): @arbolito/router's fetchReferences
 * (dolarapi, Uniswap slot0 mids, Textile tickers), cached ~60 s. Free public reads only.
 * Rates leave this module as 1e18-scaled bigint strings, so the client keeps bigint math.
 */

type Ref = ProofBundle["references"][number];

export interface LiveRefs {
  at: string;
  references: Ref[];
  unavailable: string[];
}

const fetchLive = unstable_cache(
  async (): Promise<LiveRefs> => {
    const client = createPublicClient({
      chain: celo,
      transport: http(process.env.CELO_RPC_URL || "https://forno.celo.org", { retryCount: 1, timeout: 4_000 }),
    }) as PublicClient;
    // Without a block the Uniswap mids are skipped (fetchReferences reports them unavailable).
    const block = await client.getBlockNumber().catch(() => 0n);
    const r = await fetchReferences(client, block, 2_500);
    // Throwing keeps an empty result out of the cache, so the next render retries.
    if (r.references.length === 0) throw new Error("no reference rates available");
    return { at: new Date().toISOString(), references: r.references as Ref[], unavailable: r.unavailable };
  },
  ["landing-refs-v1"],
  { revalidate: 60 },
);

/** Live references, deduped per request; null when every source is down. */
export const liveReferences = cache(async (): Promise<LiveRefs | null> => {
  try {
    return await Promise.race([fetchLive(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 7_000))]);
  } catch {
    return null;
  }
});

export type CalcKey = "arbolito" | "official" | "mep" | "blue" | "ccl" | "crypto";

export interface CalcRow {
  key: CalcKey;
  /** ARS per 1 unit of the input currency, 1e18-scaled, as a decimal string. */
  rate: string;
  source: string;
}

export type CalcRows = Record<"USD" | "BRL", CalcRow[]>;

/** "Arbolito" is the market mid on Celo: Uniswap (what executes) first, Textile's ticker as fallback. */
const MARKET: ReferenceName[] = ["uniswap_mid", "textile_mid"];

function row(refs: Ref[], key: CalcKey, names: ReferenceName[], base: string): CalcRow | undefined {
  for (const name of names) {
    const hit = resolveRate(refs, name, base, "ARS");
    if (hit && hit.rate > 0n) return { key, rate: hit.rate.toString(), source: hit.ref.source };
  }
  return undefined;
}

/** Rows for "Hacé la cuenta": US$ → ARS against official/MEP/blue/CCL/crypto, R$ → ARS against official. */
export function calcRows(refs: Ref[]): CalcRows {
  const usd = [
    row(refs, "arbolito", MARKET, "USD"),
    row(refs, "official", ["official"], "USD"),
    row(refs, "mep", ["mep"], "USD"),
    row(refs, "blue", ["blue"], "USD"),
    row(refs, "ccl", ["ccl"], "USD"),
    row(refs, "crypto", ["crypto"], "USD"),
  ];
  const brl = [row(refs, "arbolito", MARKET, "BRL"), row(refs, "official", ["official"], "BRL")];
  const keep = (xs: (CalcRow | undefined)[]) => {
    const rows = xs.filter((x): x is CalcRow => !!x);
    // Without both our rate and the official one there is no comparison to show.
    return rows.some((r) => r.key === "arbolito") && rows.some((r) => r.key === "official") ? rows : [];
  };
  return { USD: keep(usd), BRL: keep(brl) };
}
