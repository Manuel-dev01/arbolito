import type { Address, Hex, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CELO_MAINNET_ID, CONTRACTS, loadEnv } from "@arbolito/config";
import { MemoryLedger, makePublicClient, makeWalletClient } from "@arbolito/chain";
import { DbLedger } from "@arbolito/db";
import { createLlmClient, transcribe, type LlmClient } from "@arbolito/llm";
import { anchorBundle, bundleHash, verifyBundle, type ProofBundle } from "@arbolito/proof";
import {
  TextileClient,
  TextileRfqAdapter,
  UniswapV3Adapter,
  fetchReferences,
  textileFirmEnabled,
  type RefsResult,
  type VenueAdapter,
} from "@arbolito/router";
import { webDb } from "../../data";
import { westernUnionReferences } from "./competitors";
import { notReady } from "./errors";
import { logError } from "./http";
import { RateLimiter } from "./rate-limit";
import { DrizzleStore, type MiniappStore } from "./store";

/** The TextileClient surface the backend uses (tests inject a fake; it must never hit /rfq/request live). */
export type TextileTaker = Pick<TextileClient, "request" | "submit" | "status" | "cancel" | "hasPartnerKey">;

export interface AnchorOutcome {
  txHash: Hex;
  blockNumber: bigint;
}

/**
 * Everything the Mini App handlers touch, injected so unit tests run with fakes (no RPC, DB,
 * Textile, LLM or STT). Production values come from env via buildDeps().
 */
export interface MiniappDeps {
  /** Throws not_ready when DATABASE_URL is unset. */
  store(): MiniappStore;
  chain: PublicClient;
  chainId: number;
  adapters: VenueAdapter[];
  /** Reference rates, cached ~30 s. */
  references(blockNumber: bigint): Promise<RefsResult>;
  textile: TextileTaker;
  /** TEXTILE_RFQ_ENABLED: Textile-only routes are executable from a MiniPay wallet. */
  textileEnabled: boolean;
  /** ERC-8021 code every prepared call carries (ATTRIBUTION_CODE). */
  attributionCode: string | undefined;
  /** PUBLIC_BASE_URL without a trailing slash ("" = relative links). */
  baseUrl: string;
  guard: { address: Address; operator: Address } | undefined;
  /** Set only when ANCHOR_ENABLED=true and ANCHOR_PRIVATE_KEY is configured. Never set in tests. */
  anchor: ((bundle: ProofBundle) => Promise<AnchorOutcome>) | undefined;
  verify(bundle: ProofBundle): Promise<{ ok: boolean; errors: string[] }>;
  llm(): LlmClient;
  agentModel: string;
  transcribe(audio: Uint8Array, opts: { filename: string; mimeType: string; language?: string }): Promise<{ text: string }>;
  limiter: RateLimiter;
  now(): number;
}

const REFS_TTL_MS = 30_000;

export function buildDeps(): MiniappDeps {
  const env = loadEnv();
  const chain = makePublicClient();
  let refsCache: { at: number; value: RefsResult } | undefined;
  const verified = new Set<string>();

  const anchor =
    env.ANCHOR_ENABLED && env.ANCHOR_PRIVATE_KEY && CONTRACTS.arbolitoReceipts
      ? async (bundle: ProofBundle): Promise<AnchorOutcome> => {
          const account = privateKeyToAccount(env.ANCHOR_PRIVATE_KEY as Hex);
          const db = webDb();
          const r = await anchorBundle({
            bundle,
            receipts: CONTRACTS.arbolitoReceipts!,
            mode: "live",
            live: true,
            publicClient: chain,
            walletClient: makeWalletClient(account),
            // Serverless: no writable disk for the default file ledger; anchors are $0 value anyway.
            ledger: db ? new DbLedger(db, account.address) : new MemoryLedger(),
          });
          return { txHash: r.txHash, blockNumber: r.blockNumber };
        }
      : undefined;

  return {
    store() {
      const db = webDb();
      if (!db) throw notReady("The database is not configured.");
      return new DrizzleStore(db);
    },
    chain,
    chainId: CELO_MAINNET_ID,
    adapters: [new UniswapV3Adapter(chain), new TextileRfqAdapter()],
    async references(blockNumber) {
      if (refsCache && Date.now() - refsCache.at < REFS_TTL_MS) return refsCache.value;
      // Market references, plus Western Union's latest rates read through buy (best effort).
      const [value, wu] = await Promise.all([
        fetchReferences(chain, blockNumber),
        westernUnionReferences(webDb()).catch((err) => {
          logError("western union refs", err);
          return [];
        }),
      ]);
      value.references.push(...wu);
      refsCache = { at: Date.now(), value };
      return value;
    },
    textile: new TextileClient(),
    textileEnabled: textileFirmEnabled(),
    attributionCode: env.ATTRIBUTION_CODE,
    baseUrl: (env.PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
    guard: env.GUARD_ADDRESS && env.ARBOLITO_OPERATOR_ADDRESS ? { address: env.GUARD_ADDRESS as Address, operator: env.ARBOLITO_OPERATOR_ADDRESS as Address } : undefined,
    anchor,
    async verify(bundle) {
      if (!CONTRACTS.arbolitoReceipts) return { ok: false, errors: ["ArbolitoReceipts is not configured"] };
      const h = bundleHash(bundle);
      if (verified.has(h)) return { ok: true, errors: [] }; // a verified anchored bundle stays verified
      const r = await verifyBundle(bundle, { client: chain, receipts: CONTRACTS.arbolitoReceipts });
      if (r.ok) verified.add(h);
      return { ok: r.ok, errors: r.errors };
    },
    llm: () => createLlmClient(),
    agentModel: env.AGENT_MODEL,
    transcribe: (audio, opts) => transcribe(audio, opts),
    limiter: new RateLimiter(),
    now: Date.now,
  };
}

let current: MiniappDeps | undefined;

export function getDeps(): MiniappDeps {
  if (!current) {
    try {
      current = buildDeps();
    } catch (err) {
      logError("deps", err);
      throw notReady("The server is not configured.");
    }
  }
  return current;
}

/** Tests swap in fakes; pass undefined to rebuild from env. */
export function setDeps(d: MiniappDeps | undefined): void {
  current = d;
}
