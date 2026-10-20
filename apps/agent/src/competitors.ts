/**
 * Keeps Western Union's rates fresh for "vs Western Union" on quotes and receipts. Every few hours
 * it buys one short browser session through buy (x402, USDT, from the buy payer), reads Western
 * Union's converter for dollars → reais and pesos, and stores the readings with the payment.
 * Enabled with COMPETITORS_RUNNER=live and BUY_PAYER_PRIVATE_KEY.
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

export function startCompetitorsRunner(db: Db, env: Env): (() => void) | null {
  if (env.COMPETITORS_RUNNER !== "live") return null;
  if (!env.BUY_PAYER_PRIVATE_KEY) {
    log("[competitors] COMPETITORS_RUNNER=live but BUY_PAYER_PRIVATE_KEY is missing: not running");
    return null;
  }
  const payer = privateKeyToAccount(env.BUY_PAYER_PRIVATE_KEY as Hex);
  const ledger = new DbLedger(db, payer.address);
  const client = makePublicClient();
  const url = `${env.BUY_GATEWAY_URL.replace(/\/$/, "")}/v1/browser/sessions`;
  let stopped: string | null = null;
  let busy = false;

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      const fresh = await latestCompetitorRates(db, "western_union", REFRESH_MS);
      if (CORRIDORS.every((c) => fresh.some((r) => r.corridor === c))) return;

      const request = { url, method: "POST" as const, body: { durationMinutes: MINUTES } };
      const quote = await quoteRequest(request, TOKENS[env.BUY_PAY_TOKEN].address);
      const paid = await payRequest(request, { account: payer, quote, maxAmount: MAX_CALL, ledger, caps: capsFromEnv(), purpose: `buy browser.sessions.create ${MINUTES}m (Western Union rates)` });
      const tx = paid.settlement?.transaction ?? null;
      log(`[competitors] paid ${Number(paid.amount) / 1e6} ${env.BUY_PAY_TOKEN} for a browser${tx ? ` (tx ${tx})` : ""}`);

      const session = PaidBrowserResponse.parse(paid.body).browser;
      const { rates, errors } = await readWesternUnion(session, CORRIDORS);
      for (const e of errors) log(`[competitors] ${e}`);

      const refs = (await fetchReferences(client, await client.getBlockNumber()).catch(() => ({ references: [] as Reference[] }))).references;
      const keep: CompetitorRate[] = [];
      for (const r of rates) {
        const ref = referenceFor(r.corridor, refs);
        if (ref !== null && !plausible(r.rate, ref)) log(`[competitors] dropped ${r.corridor} ${r.rate.toFixed(4)}: too far from ${ref}`);
        else keep.push(r);
      }
      const at = new Date();
      await insertCompetitorRates(
        db,
        keep.map((r) => ({
          provider: r.provider,
          corridor: r.corridor,
          rate: r.rate.toFixed(6),
          sendAmount: String(r.sendAmount),
          receiveAmount: String(r.receiveAmount),
          sourceUrl: r.sourceUrl,
          paymentTx: tx,
          paidAtomic: paid.amount.toString(),
          at,
        })),
      );
      log(`[competitors] Western Union: ${keep.map((r) => `${r.corridor} ${r.rate.toFixed(4)}`).join(", ") || "nothing read"}`);
    } catch (e) {
      if (e instanceof PaymentUncertainError) {
        stopped = e.message;
        log(`[competitors] STOPPED (${e.message}); check the buy payer's transfers, then restart`);
      } else log(`[competitors] tick failed: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }

  log(`[competitors] runner on: payer ${payer.address}, Western Union every ${REFRESH_MS / 3_600_000} h`);
  void tick();
  const timer = setInterval(() => void tick(), CHECK_MS);
  return () => clearInterval(timer);
}
