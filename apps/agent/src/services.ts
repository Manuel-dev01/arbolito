import type { PublicClient } from "viem";
import { loadEnv } from "@arbolito/config";
import { makePublicClient } from "@arbolito/chain";
import { getDb, type Db } from "@arbolito/db";
import { TextileRfqAdapter, UniswapV3Adapter, fetchReferences, type RefsResult, type VenueAdapter } from "@arbolito/router";

/** Process-wide singletons for the bot. */
export interface Services {
  db: Db;
  chain: PublicClient;
  adapters: VenueAdapter[];
  references(blockNumber: bigint): Promise<RefsResult>;
}

let services: Services | undefined;

/** Reference rates move slowly; caching them for 30s keeps a quote well under the 4s budget. */
const REFS_TTL_MS = 30_000;

export function getServices(): Services {
  if (services) return services;
  const env = loadEnv();
  const chain = makePublicClient();
  let cache: { at: number; value: RefsResult } | undefined;
  services = {
    db: getDb(env.DATABASE_URL),
    chain,
    adapters: [new UniswapV3Adapter(chain), new TextileRfqAdapter()],
    async references(blockNumber) {
      if (cache && Date.now() - cache.at < REFS_TTL_MS) return cache.value;
      const value = await fetchReferences(chain, blockNumber);
      cache = { at: Date.now(), value };
      return value;
    },
  };
  return services;
}
