import { createPublicClient, fallback, http, type Address, type Hex, type PublicClient } from "viem";
import { celo } from "viem/chains";
import { CONTRACTS } from "@arbolito/config";
import { bundleHash, receiptsAbi, verifyBundle, type ProofBundle } from "@arbolito/proof";

/** Server-side reads only (public RPC). Never sends anything. */

export const RECEIPTS_ADDRESS = CONTRACTS.arbolitoReceipts as Address | undefined;

/** Public RPC the browser may use for its own check. Never the server's (possibly keyed) CELO_RPC_URL. */
export const PUBLIC_RPC_URL = "https://forno.celo.org";

let client: PublicClient | undefined;
/**
 * The keyed primary (CELO_RPC_URL) with forno behind it. The primary may not be an archive node:
 * Chainstack's free Global Node refuses eth_getLogs on week-old blocks ("Archive, Debug and Trace
 * requests are not available on your plan", 2026-10-27), which every receipt check needs, so
 * those reads fall through to forno.
 */
function publicClient(): PublicClient {
  const urls = [...new Set([process.env.CELO_RPC_URL, process.env.CELO_RPC_URL_FALLBACK, PUBLIC_RPC_URL].filter((u): u is string => !!u))];
  client ??= createPublicClient({
    chain: celo,
    transport: fallback(urls.map((u) => http(u, { retryCount: 1, timeout: 8_000 }))),
  }) as PublicClient;
  return client;
}

/** JSON-safe outcome of verifyBundle (bigints as strings) for the page and the data cache. */
export interface Verification {
  ok: boolean;
  bundleHash: string;
  anchor: { txHash: string; blockNumber: string; emitter: string } | null;
  errors: string[];
  checkedAt: string;
}

/**
 * Runs packages/proof's verifyBundle against Celo mainnet: hash anchored, routeId and emitter in the
 * ReceiptAnchored event, execution tx succeeded at the stated block with the stated attribution and
 * delivered exactly execution.amountOut. Throws on RPC failure (so a transient error is not cached).
 */
export async function verifyOnchain(bundle: ProofBundle): Promise<Verification> {
  if (!RECEIPTS_ADDRESS) throw new Error("ArbolitoReceipts address is not configured");
  const r = await verifyBundle(bundle, { client: publicClient(), receipts: RECEIPTS_ADDRESS });
  return {
    ok: r.ok,
    bundleHash: r.bundleHash ?? bundleHash(bundle),
    anchor: r.anchor ? { txHash: r.anchor.txHash, blockNumber: r.anchor.blockNumber.toString(), emitter: r.anchor.emitter } : null,
    errors: r.errors,
    checkedAt: new Date().toISOString(),
  };
}

/** The ReceiptAnchored event for a bundle hash, if any (anchoredAt → log at that block). */
export async function findAnchor(hash: Hex): Promise<{ txHash: string; blockNumber: string } | null> {
  if (!RECEIPTS_ADDRESS) return null;
  const c = publicClient();
  const at = await c.readContract({ address: RECEIPTS_ADDRESS, abi: receiptsAbi, functionName: "anchoredAt", args: [hash] });
  if (at === 0n) return null;
  const logs = await c.getLogs({
    address: RECEIPTS_ADDRESS,
    event: receiptsAbi.find((x) => x.type === "event" && x.name === "ReceiptAnchored")!,
    args: { bundleHash: hash },
    fromBlock: at,
    toBlock: at,
  });
  const log = logs[0];
  return log?.transactionHash ? { txHash: log.transactionHash, blockNumber: at.toString() } : null;
}
