import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  type Account,
  type PublicClient,
  type Transport,
  type WalletClient,
  type Chain,
} from "viem";
import { celoMainnet as celo } from "./celo";
import { loadEnv } from "@arbolito/config";

export interface ClientOptions {
  /** Override RPC (e.g. an anvil fork at http://127.0.0.1:8547). Defaults to CELO_RPC_URL + fallback. */
  rpcUrl?: string;
  chain?: Chain;
  /** ms between polls (receipts, blocks). Use ~100 on anvil, where blocks are instant. */
  pollingInterval?: number;
}

function transport(opts: ClientOptions): Transport {
  if (opts.rpcUrl) return http(opts.rpcUrl, { batch: true, retryCount: 2, timeout: 20_000 });
  const env = loadEnv();
  const urls = [env.CELO_RPC_URL, env.CELO_RPC_URL_FALLBACK].filter((u): u is string => !!u);
  return fallback(urls.map((u) => http(u, { batch: true, retryCount: 2, timeout: 20_000 })));
}

export function makePublicClient(opts: ClientOptions = {}): PublicClient {
  return createPublicClient({ chain: opts.chain ?? celo, transport: transport(opts), pollingInterval: opts.pollingInterval }) as PublicClient;
}

export function makeWalletClient(account: Account, opts: ClientOptions = {}): WalletClient {
  return createWalletClient({ account, chain: opts.chain ?? celo, transport: transport(opts), pollingInterval: opts.pollingInterval });
}

/** True when the RPC node is an anvil instance (used to guard fork-mode sends). */
export async function isAnvil(client: PublicClient): Promise<boolean> {
  try {
    const version: unknown = await client.request({ method: "web3_clientVersion" as never });
    return typeof version === "string" && version.toLowerCase().includes("anvil");
  } catch {
    return false;
  }
}
