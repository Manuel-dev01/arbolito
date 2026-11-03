/**
 * Arbolito pays other agents for what it uses, over x402 v2 through Celo's facilitator, and rates
 * each one onchain (ERC-8004 giveFeedback) after the call. The providers are outside Celo agents
 * registered on ERC-8004; none is the team's own. Enabled with AGENT_BUYS=live and
 * BUY_PAYER_PRIVATE_KEY (the agent wallet, ERC-8004 #9976); `pnpm agent:buy` quotes one by hand
 * and `--live` pays it.
 *
 * Money rules: the free 402 is the quote and is checked against the provider's maximum; the total
 * ever spent is capped (AGENT_BUYS_MAX_USD, counted from agent_purchases before each call); spend
 * also counts against the build caps; a payment whose outcome is unclear stops the runner, and
 * nothing is retried. The rating is a separate, tagged, gas-only transaction.
 */
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKENS, type Env } from "@arbolito/config";
import { REPUTATION_REGISTRY, capsFromEnv, encodeGiveFeedback, log, makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { DbLedger, agentPurchases, insertAgentPurchase, recentAgentPurchases, type Db } from "@arbolito/db";
import { PaymentUncertainError, payV2, quoteV2 } from "@arbolito/x402";
import { eq } from "drizzle-orm";

export interface Provider {
  name: string;
  /** ERC-8004 agentId on Celo. */
  agentId: number;
  url: string;
  /** Token we pay in (the provider's 402 must offer it). */
  pay: "USDC" | "USDT" | "USAT";
  /** Refuse a 402 above this, micro-USD. */
  maxUsdMicros: bigint;
  /** What Arbolito uses the answer for (shown on /agent). */
  usedFor: string;
}

/** Outside agents Arbolito buys from (checked on 8004scan; quoted free before any payment). */
export const PROVIDERS: Provider[] = [
  { name: "RemitRoute", agentId: 9308, url: "https://remitroute.vercel.app/api/fx-route", pay: "USDC", maxUsdMicros: 20_000n, usedFor: "Mento FX route and live rate: a second opinion next to Arbolito's own references" },
];

const REFRESH_MS = 12 * 3_600_000;
const CHECK_MS = 3_600_000;

export interface BuyResult {
  provider: string;
  priceMicros: bigint;
  paymentTx: string | null;
  feedbackTx: string | null;
  body: unknown;
}

/** Micro-USD already spent on agent purchases (sent or unclear), the budget's numerator. */
async function spentMicros(db: Db): Promise<bigint> {
  const rows = await recentAgentPurchases(db, 1000);
  return rows.filter((r) => r.status !== "failed").reduce((s, r) => s + BigInt(r.usdMicros), 0n);
}

/** The free 402 for a provider, in its payment token (nothing is signed or sent). */
export async function quoteProvider(p: Provider) {
  return quoteV2(p.url, TOKENS[p.pay].address);
}

/**
 * One paid call and its rating. Throws PaymentUncertainError when the payment's outcome is unclear
 * (callers must not retry); the row is recorded as "uncertain" first.
 */
export async function buyFromProvider(db: Db, env: Env, p: Provider): Promise<BuyResult> {
  if (!env.BUY_PAYER_PRIVATE_KEY) throw new Error("BUY_PAYER_PRIVATE_KEY is not set");
  const quote = await quoteProvider(p);
  const price = quote.amount; // 6-decimal dollar tokens: atomic units are micro-USD
  if (price > p.maxUsdMicros) throw new Error(`${p.name} asks ${price} micro-USD, above our ${p.maxUsdMicros}`);
  const budget = BigInt(Math.round(env.AGENT_BUYS_MAX_USD * 1e6));
  const spent = await spentMicros(db);
  if (spent + price > budget) throw new Error(`agent purchases budget reached (${Number(spent) / 1e6} of US$ ${env.AGENT_BUYS_MAX_USD})`);

  const payer = privateKeyToAccount(env.BUY_PAYER_PRIVATE_KEY as Hex);
  const publicClient = makePublicClient();
  let paymentTx: string | null = null;
  let body: unknown = null;
  let ok = false;
  try {
    const paid = await payV2(p.url, {
      account: payer,
      publicClient,
      quote,
      maxAmount: p.maxUsdMicros,
      usdMicros: price,
      ledger: new DbLedger(db, payer.address),
      caps: capsFromEnv(),
      purpose: `x402 ${p.name} (agent #${p.agentId})`,
      builderCode: env.ATTRIBUTION_CODE,
    });
    paymentTx = paid.settlement?.transaction ?? null;
    body = paid.body;
    ok = paid.body !== null;
  } catch (e) {
    if (e instanceof PaymentUncertainError) {
      await insertAgentPurchase(db, { provider: p.name, providerAgentId: p.agentId, url: p.url, asset: p.pay, amount: price.toString(), usdMicros: price.toString(), status: "uncertain", usedFor: p.usedFor });
    }
    throw e;
  }
  const id = await insertAgentPurchase(db, {
    provider: p.name,
    providerAgentId: p.agentId,
    url: p.url,
    asset: p.pay,
    amount: price.toString(),
    usdMicros: price.toString(),
    status: "sent",
    paymentTx,
    usedFor: p.usedFor,
    used: ok,
  });
  log(`[agent-buys] paid ${p.name} ${Number(price) / 1e6} ${p.pay}${paymentTx ? ` (tx ${paymentTx})` : ""}`);

  // Rate the provider on its ERC-8004 identity: 100 when it answered with data, 20 when it took the payment without.
  let feedbackTx: string | null = null;
  try {
    const score = ok ? 100 : 20;
    const r = await sendGuarded({
      mode: "live",
      live: true,
      publicClient,
      walletClient: makeWalletClient(payer),
      to: REPUTATION_REGISTRY as Address,
      data: encodeGiveFeedback({ agentId: BigInt(p.agentId), score, tag1: "x402", tag2: "paid-call", endpoint: p.url, feedbackURI: paymentTx ? `https://celoscan.io/tx/${paymentTx}` : p.url }),
      usdMicros: 0n,
      purpose: `ERC-8004 feedback for ${p.name} #${p.agentId}`,
      attributionCode: env.ATTRIBUTION_CODE,
      feeCurrency: "USDT",
    });
    feedbackTx = r.hash;
    await db.update(agentPurchases).set({ feedbackTx, feedbackScore: score }).where(eq(agentPurchases.id, id));
  } catch (e) {
    log(`[agent-buys] paid ${p.name}, but the ERC-8004 rating failed: ${(e as Error).message}`);
  }
  return { provider: p.name, priceMicros: price, paymentTx, feedbackTx, body };
}

export function startAgentBuysRunner(db: Db, env: Env): (() => void) | null {
  if (env.AGENT_BUYS !== "live") return null;
  if (!env.BUY_PAYER_PRIVATE_KEY || !env.ATTRIBUTION_CODE) {
    log("[agent-buys] AGENT_BUYS=live but BUY_PAYER_PRIVATE_KEY or ATTRIBUTION_CODE is missing: not running");
    return null;
  }
  let stopped: string | null = null;
  let busy = false;
  const last = new Map<string, number>();

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      for (const p of PROVIDERS) {
        if (Date.now() - (last.get(p.name) ?? 0) < REFRESH_MS) continue;
        last.set(p.name, Date.now());
        await buyFromProvider(db, env, p).catch((e) => {
          if (e instanceof PaymentUncertainError) throw e;
          log(`[agent-buys] ${p.name}: ${(e as Error).message}`);
        });
      }
    } catch (e) {
      stopped = (e as Error).message;
      log(`[agent-buys] STOPPED (${stopped}); check the agent wallet's transfers, then restart`);
    } finally {
      busy = false;
    }
  }

  log(`[agent-buys] runner on: ${PROVIDERS.map((p) => `${p.name} #${p.agentId}`).join(", ")} every ${REFRESH_MS / 3_600_000} h, budget US$ ${env.AGENT_BUYS_MAX_USD}`);
  void tick();
  const timer = setInterval(() => void tick(), CHECK_MS);
  return () => clearInterval(timer);
}
