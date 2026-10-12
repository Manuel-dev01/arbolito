import type { PublicClient } from "viem";
import { loadEnv } from "@arbolito/config";
import { makePublicClient } from "@arbolito/chain";
import { getDb, type Db } from "@arbolito/db";
import { createMiniAppClient, type MiniAppClient } from "./api";
import { makeLinks, type Links } from "./links";

/** Process-wide singletons for the bot. */
export interface Services {
  db: Db;
  /** Read-only chain access (balances of the linked wallet). */
  chain: PublicClient;
  /** The web backend's Mini App API: quotes and receipts, shared with the mini app. */
  miniapp: MiniAppClient;
  /** Links into the mini app; null when neither MINI_APP_URL nor PUBLIC_BASE_URL is set. */
  links: Links | null;
  /** PUBLIC_BASE_URL (receipt links). */
  baseUrl: string | undefined;
}

let services: Services | undefined;

export function getServices(): Services {
  if (services) return services;
  const env = loadEnv();
  services = {
    db: getDb(env.DATABASE_URL),
    chain: makePublicClient(),
    miniapp: createMiniAppClient({ baseUrl: env.PUBLIC_BASE_URL }),
    links: makeLinks(env.MINI_APP_URL ?? env.PUBLIC_BASE_URL),
    baseUrl: env.PUBLIC_BASE_URL,
  };
  return services;
}
