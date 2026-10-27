import { unstable_cache } from "next/cache";
import { cache } from "react";
import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { celo } from "viem/chains";
import { fetchReferences } from "@arbolito/router";
import type { ProofBundle } from "@arbolito/proof";

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
    // The keyed primary first, forno behind it (the primary may rate-limit or refuse a read).
    const urls = [...new Set([process.env.CELO_RPC_URL, process.env.CELO_RPC_URL_FALLBACK, "https://forno.celo.org"].filter((u): u is string => !!u))];
    const client = createPublicClient({
      chain: celo,
      transport: fallback(urls.map((u) => http(u, { retryCount: 1, timeout: 4_000 }))),
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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([fetchLive(), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), 7_000)))]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
});

export { calcRows, type CalcKey, type CalcRow, type CalcRows } from "./public-data";
