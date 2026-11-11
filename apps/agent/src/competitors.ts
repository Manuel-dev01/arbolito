/**
 * Keeps Western Union's rates fresh for "vs Western Union" on quotes and receipts. Every few hours
 * it buys one short browser session through buy (x402, USDT, from the buy payer), reads Western
 * Union's converter for dollars → reais and pesos, and stores the readings with the payment.
 * Enabled with COMPETITORS_RUNNER=live and BUY_PAYER_PRIVATE_KEY; `pnpm buy rates --live` runs one
 * refresh by hand.
 *
 * Money rules: the free 402 is checked against MAX_CALL before signing; spend counts against the
 * build caps (database ledger, per payer); a payment whose outcome is unclear stops the runner
 * until a restart, and nothing is retried.
 */
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKENS, type Env } from "@arbolito/config";
import { capsFromEnv, log, makePublicClient } from "@arbolito/chain";
import { PaidBrowserResponse, plausible, readWesternUnion, type CompetitorRate, type Corridor } from "@arbolito/competitors";
import { DbLedger, insertCompetitorRates, latestCompetitorRates, type Db } from "@arbolito/db";
import { fetchReferences, type Reference } from "@arbolito/router";
import { PaymentUncertainError, payRequest, quoteRequest } from "@arbolito/x402";

const CORRIDORS: Corridor[] = ["USD-BRL", "USD-ARS"];
const REFRESH_MS = 6 * 3_600_000;
const CHECK_MS = 3_600_000;
/** A 2-minute browser costs US$ 0.0042; refuse anything above a cent. */
const MAX_CALL = 10_000n;
const MINUTES = 2;
const PURPOSE = `buy browser.sessions.create ${MINUTES}m (Western Union rates)`;
/** An unresolved payment this recent keeps the runner stopped until someone checks it onchain. */
const UNRESOLVED_LOOKBACK_MS = 7 * 24 * 3_600_000;
/**
 * Wait before the first paid read. A deploy overlaps the old bot, the new one dies on Telegram's 409
 * ("only one bot instance") and restarts; on 2026-11-08 and 11-10 each of those short-lived starts
 * paid buy at once, 3 payments in 10 seconds, none of which got an answer.
 */
const STARTUP_DELAY_MS = 3 * 60_000;

/** Our own reference for a sanity check: crypto/official pesos, the market real. */
function referenceFor(c: Corridor, refs: Reference[]): number | null {
  const fiat = c.split("-")[1];
  const order = fiat === "ARS" ? ["crypto", "official", "uniswap_mid"] : ["textile_mid", "uniswap_mid", "official"];
  for (const name of order) {
    const r = refs.find((x) => x.name === name && x.pair === `USD/${fiat}`);
    if (r && Number(r.rate) > 0) return Number(r.rate);
  }
  return null;
}

export interface RefreshResult {
  skipped: boolean;
  paymentTx: string | null;
  stored: CompetitorRate[];
  errors: string[];
}

/**
 * One refresh: skipped when every corridor has a reading younger than REFRESH_MS (unless forced).
 * Throws PaymentUncertainError when a payment's outcome is unclear (callers must not retry).
 */
export async function refreshWesternUnion(db: Db, env: Env, o: { force?: boolean } = {}): Promise<RefreshResult> {
  if (!env.BUY_PAYER_PRIVATE_KEY) throw new Error("BUY_PAYER_PRIVATE_KEY is not set");
  if (!o.force) {
    const fresh = await latestCompetitorRates(db, "western_union", REFRESH_MS);
    if (CORRIDORS.every((c) => fresh.some((r) => r.corridor === c))) return { skipped: true, paymentTx: null, stored: [], errors: [] };
  }
  const payer = privateKeyToAccount(env.BUY_PAYER_PRIVATE_KEY as Hex);
  const ledger = new DbLedger(db, payer.address);
  // Decided from the ledger, not from memory, so a restart or a second instance can't pay again.
  const now = Date.now();
  const past = await ledger.attempts(PURPOSE, new Date(now - UNRESOLVED_LOOKBACK_MS));
  const open = past.find((a) => a.status === "reserved");
  if (open) {
    throw new PaymentUncertainError(`payment ${open.id} (${open.createdAt.toISOString()}) has no recorded outcome; check the payer's transfers and mark it in spend_ledger before paying again`);
  }
  if (!o.force && past.some((a) => a.createdAt.getTime() > now - REFRESH_MS)) return { skipped: true, paymentTx: null, stored: [], errors: [] };
  const request = { url: `${env.BUY_GATEWAY_URL.replace(/\/$/, "")}/v1/browser/sessions`, method: "POST" as const, body: { durationMinutes: MINUTES } };
  const quote = await quoteRequest(request, TOKENS[env.BUY_PAY_TOKEN].address);
  const paid = await payRequest(request, {
    account: payer,
    quote,
    maxAmount: MAX_CALL,
    ledger,
    caps: capsFromEnv(),
    purpose: PURPOSE,
  });
  const paymentTx = paid.settlement?.transaction ?? null;
  log(`[competitors] paid ${Number(paid.amount) / 1e6} ${env.BUY_PAY_TOKEN} for a browser${paymentTx ? ` (tx ${paymentTx})` : ""}`);

  const session = PaidBrowserResponse.parse(paid.body).browser;
  const { rates, errors } = await readWesternUnion(session, CORRIDORS);
  const client = makePublicClient();
  const refs = (await fetchReferences(client, await client.getBlockNumber()).catch(() => ({ references: [] as Reference[] }))).references;
  const stored: CompetitorRate[] = [];
  for (const r of rates) {
    const ref = referenceFor(r.corridor, refs);
    if (ref !== null && !plausible(r.rate, ref)) errors.push(`dropped ${r.corridor} ${r.rate.toFixed(4)}: too far from ${ref}`);
    else stored.push(r);
  }
  const at = new Date();
  await insertCompetitorRates(
    db,
    stored.map((r) => ({
      provider: r.provider,
      corridor: r.corridor,
      rate: r.rate.toFixed(6),
      sendAmount: String(r.sendAmount),
      receiveAmount: String(r.receiveAmount),
      sourceUrl: r.sourceUrl,
      paymentTx,
      paidAtomic: paid.amount.toString(),
      at,
    })),
  );
  return { skipped: false, paymentTx, stored, errors };
}

export function startCompetitorsRunner(db: Db, env: Env): (() => void) | null {
  if (env.COMPETITORS_RUNNER !== "live") return null;
  if (!env.BUY_PAYER_PRIVATE_KEY) {
    log("[competitors] COMPETITORS_RUNNER=live but BUY_PAYER_PRIVATE_KEY is missing: not running");
    return null;
  }
  let stopped: string | null = null;
  let busy = false;
  /** Set when a paid attempt stored nothing (or failed after it may have paid): wait a full refresh before paying again. */
  let backoffUntil = 0;

  async function tick() {
    if (busy || stopped || Date.now() < backoffUntil) return;
    busy = true;
    try {
      const r = await refreshWesternUnion(db, env);
      if (r.skipped) return;
      if (r.stored.length === 0) backoffUntil = Date.now() + REFRESH_MS;
      for (const e of r.errors) log(`[competitors] ${e}`);
      log(`[competitors] Western Union: ${r.stored.map((x) => `${x.corridor} ${x.rate.toFixed(4)}`).join(", ") || "nothing read"}`);
    } catch (e) {
      if (e instanceof PaymentUncertainError) {
        stopped = e.message;
        log(`[competitors] STOPPED (${e.message}); check the buy payer's transfers, then restart`);
      } else {
        backoffUntil = Date.now() + REFRESH_MS;
        log(`[competitors] tick failed: ${(e as Error).message}; next try in ${REFRESH_MS / 3_600_000} h`);
      }
    } finally {
      busy = false;
    }
  }

  log(`[competitors] runner on: payer ${privateKeyToAccount(env.BUY_PAYER_PRIVATE_KEY as Hex).address}, Western Union every ${REFRESH_MS / 3_600_000} h`);
  const first = setTimeout(() => void tick(), STARTUP_DELAY_MS);
  const timer = setInterval(() => void tick(), CHECK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
