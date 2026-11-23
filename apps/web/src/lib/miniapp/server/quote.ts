import { formatUnits, parseUnits, zeroAddress, type Address } from "viem";
import type { z } from "zod";
import { TOKENS, tokenByAddress } from "@arbolito/config";
import { savingsVsOfficial } from "@arbolito/proof";
import { TextileApiError, plan, toAtomic, type Quote, type Reference, type Route } from "@arbolito/router";
import { EXACT_OUT, SYMBOLS, type QuoteRequest, type QuoteResponse, type Sym } from "../contract";
import type { MiniappDeps } from "./deps";
import { ApiFailure, badRequest, belowMinimum, noRoute, notFound, notReady, upstream } from "./errors";
import { decodePayload, encodePayload } from "./serde";
import type { QuoteRow } from "./store";
import { vsWesternUnion } from "./competitors";

/**
 * Textile's smallest RFQ is about US$ 1 (it refused 3,206 wCOP with "below the RFQ minimum
 * (3208…)" on 2026-11-01). A Textile-only route under it can't be prepared, so it isn't offered.
 */
export const TEXTILE_MIN_USD_MICROS = 1_000_000n;

/** The dollar side of a single-leg route (USD stables are 6 decimals), or null if neither end is a dollar. */
function usdSideMicros(route: Route): bigint | null {
  const usd = (a: Address) => tokenByAddress(a).kind === "usd";
  if (usd(route.tokenIn)) return route.amountIn;
  if (usd(route.tokenOut)) return route.expectedOut;
  return null;
}

/** How long a quote card stays confirmable. */
export const QUOTE_TTL_MS = 60_000;

export type RouteKind = "uniswap" | "textile" | "mixed" | "other";

/** all-Uniswap, a single Textile RFQ leg, a mix of the two, or something else (never executable). */
export function routeKind(route: Route): RouteKind {
  const venues = route.legs.map((l) => l.quote.venue);
  if (venues.every((v) => v === "uniswap_v3")) return "uniswap";
  if (venues.length === 1 && venues[0] === "textile_rfq") return "textile";
  if (venues.every((v) => v === "uniswap_v3" || v === "textile_rfq")) return "mixed";
  return "other";
}

/**
 * v1 executable set for a MiniPay wallet: all-Uniswap routes (approve + one atomic swap), or a
 * route whose only leg is Textile (firm quote taken at /prepare; gated by TEXTILE_RFQ_ENABLED).
 * Mixed Uniswap+Textile routes can't run from a user wallet in one go: alternatives only.
 */
export function isMiniPayExecutable(route: Route, textileEnabled: boolean): boolean {
  const k = routeKind(route);
  return k === "uniswap" || (k === "textile" && textileEnabled);
}

export const venuesOf = (route: Route): ("uniswap" | "textile")[] => [
  ...new Set(route.legs.map((l) => (l.quote.venue === "uniswap_v3" ? ("uniswap" as const) : ("textile" as const)))),
];

export function symOf(address: string): Sym {
  const s = tokenByAddress(address).symbol;
  if (!(SYMBOLS as readonly string[]).includes(s)) throw new Error(`${s} is not a Mini App token`);
  return s as Sym;
}

/** Human amount → atomic, refusing more decimals than the token has (never silently rounds). */
export function parseAmount(sym: Sym, human: string): bigint {
  const t = TOKENS[sym];
  const frac = human.split(".")[1] ?? "";
  if (frac.length > t.decimals) throw badRequest(`${sym} supports at most ${t.decimals} decimals.`);
  const atomic = toAtomic(t.address, human);
  if (atomic <= 0n) throw badRequest("Amount must be greater than zero.");
  return atomic;
}

/** to-units per 1 from-unit as a plain decimal string (display only). */
export function rateString(tokenIn: Address, amountIn: bigint, tokenOut: Address, amountOut: bigint): string {
  const a = Number(formatUnits(amountIn, tokenByAddress(tokenIn).decimals));
  const b = Number(formatUnits(amountOut, tokenByAddress(tokenOut).decimals));
  if (a === 0) return "0";
  const r = b / a;
  const s = String(Number(r.toPrecision(6)));
  return s.includes("e") ? r.toFixed(12).replace(/0+$/, "") : s;
}

export interface PlannedQuote {
  route: Route;
  alternatives: Route[];
  quotesConsidered: Quote[];
  references: Reference[];
  blockNumber: bigint;
}

/** Plans across Uniswap + Textile (preview) and picks the best route a MiniPay wallet can execute. */
export async function planQuote(deps: MiniappDeps, from: Sym, to: Sym, amountIn: bigint, account?: Address): Promise<PlannedQuote> {
  if (from === to) throw badRequest("from and to must differ.");
  const blockNumber = await deps.chain.getBlockNumber();
  const [planned, refs] = await Promise.all([
    plan({
      client: deps.chain,
      adapters: deps.adapters,
      tokenIn: TOKENS[from].address,
      tokenOut: TOKENS[to].address,
      amountIn,
      taker: account ?? zeroAddress,
      blockNumber,
    }),
    deps.references(blockNumber).catch(() => ({ references: [] as Reference[], unavailable: ["all"] })),
  ]);
  const all = planned.best ? [planned.best, ...planned.alternatives] : [];
  const executable = all.filter((r) => isMiniPayExecutable(r, deps.textileEnabled));
  const tooSmall = (r: Route) => routeKind(r) === "textile" && (usdSideMicros(r) ?? TEXTILE_MIN_USD_MICROS) < TEXTILE_MIN_USD_MICROS;
  const route = executable.find((r) => !tooSmall(r));
  const staged = deps.textileEnabled ? all.find((r) => r.legs.length === 2 && routeKind(r) === "mixed") : undefined;
  // A drained pool can still quote dust. Never silently substitute that for a much better
  // two-step market route: each leg needs a fresh quote and the user's separate approval.
  if (staged && (!route || route.expectedOut * 10_000n < staged.expectedOut * 9_900n)) {
    if (staged.legs[0]!.quote.amountOut < TEXTILE_MIN_USD_MICROS) throw belowMinimum();
    throw new ApiFailure("via_dollars", "Change to dollars first, then request a new quote for the destination. The second rate is not locked.", 422);
  }
  if (!route) {
    if (executable.length) throw belowMinimum();
    if (planned.venueErrors.length) throw upstream("A market did not answer. Try again; no money moved.");
    throw noRoute();
  }
  assertHealthy(route, from, to, refs.references, planned.venueErrors.length > 0);
  return {
    route,
    alternatives: all.filter((r) => r !== route),
    quotesConsidered: planned.quotesConsidered,
    references: refs.references,
    blockNumber,
  };
}

/**
 * Even when the better venue timed out, a drained pool's dust quote must not be offered. Uses
 * independent references (never the damaged pool's own mid); normal FX spreads remain valid.
 */
function assertHealthy(route: Route, from: Sym, to: Sym, references: readonly Reference[], venueDown: boolean): void {
  const perUsd = (s: Sym): bigint | null => {
    if (TOKENS[s].kind === "usd") return 10n ** 18n;
    const currency = s.slice(1).toUpperCase();
    for (const name of ["textile_mid", "crypto", "interbank", "official"] as const) {
      const r = references.find((x) => x.name === name && x.pair === `USD/${currency}`);
      if (r) {
        try { const n = parseUnits(r.rate, 18); if (n > 0n) return n; } catch { /* skip malformed reference */ }
      }
    }
    return null;
  };
  const inputPerUsd = perUsd(from);
  const outputPerUsd = perUsd(to);
  if (inputPerUsd && outputPerUsd) {
    const fairOut = (route.amountIn * outputPerUsd * 10n ** BigInt(TOKENS[to].decimals)) / (inputPerUsd * 10n ** BigInt(TOKENS[from].decimals));
    if (route.expectedOut * 2n < fairOut) {
      if (venueDown) throw upstream("A market did not answer and the remaining pool has insufficient liquidity.");
      throw noRoute("There is not enough healthy liquidity for this amount right now.");
    }
  }
}

/**
 * A payment whose payee must get exactly `amountOut` ("₦75,000"): Textile's preview says what it costs.
 * Only for currencies whose one market is Textile (EXACT_OUT): there is no better venue to miss.
 */
export async function planExactOut(deps: MiniappDeps, from: Sym, to: Sym, amountOut: bigint, account?: Address): Promise<PlannedQuote> {
  if (from !== "USDT" || !EXACT_OUT.includes(to)) throw badRequest("This currency can't be paid to the exact amount. Enter the dollars instead.");
  if (!deps.textileEnabled) throw notReady("Textile execution is not enabled yet.");
  const tokenIn = TOKENS[from].address;
  const tokenOut = TOKENS[to].address;
  const blockNumber = await deps.chain.getBlockNumber();
  const [preview, refs] = await Promise.all([
    deps.textile.preview({ chainId: deps.chainId, sellToken: tokenIn, buyToken: tokenOut, sellAmount: 0n, buyAmount: amountOut }, 5_000).catch((err: unknown) => {
      if (err instanceof TextileApiError && err.body.includes("corridor_unavailable")) throw noRoute();
      throw upstream("A market did not answer. Try again; no money moved.");
    }),
    deps.references(blockNumber).catch(() => ({ references: [] as Reference[], unavailable: ["all"] })),
  ]);
  const cost = preview.takerPays ?? preview.sellAmount;
  if (preview.status !== "preview" || !cost || BigInt(cost) <= 0n || preview.buyAmount === undefined || BigInt(preview.buyAmount) !== amountOut) throw noRoute("No maker can fill this size right now.");
  const amountIn = BigInt(cost);
  if (amountIn < TEXTILE_MIN_USD_MICROS) throw belowMinimum();
  const quote: Quote = { venue: "textile_rfq", tokenIn, tokenOut, amountIn, amountOut, blockNumber, firm: false, raw: { kind: "preview", ...preview } };
  const route: Route = {
    id: crypto.randomUUID(),
    label: `${from} →(textile) ${to}, exact output`,
    legs: [{ quote, minOut: amountOut }],
    tokenIn,
    tokenOut,
    amountIn,
    expectedOut: amountOut,
    minOut: amountOut,
    taker: account ?? zeroAddress,
  };
  assertHealthy(route, from, to, refs.references, false);
  return { route, alternatives: [], quotesConsidered: [quote], references: refs.references, blockNumber };
}

export function toQuoteResponse(row: Pick<QuoteRow, "id" | "expiresAt">, q: PlannedQuote): z.infer<typeof QuoteResponse> {
  const r = q.route;
  const savings = savingsVsOfficial(r, r.expectedOut, q.references);
  return {
    quoteId: row.id,
    expiresAt: row.expiresAt.toISOString(),
    from: symOf(r.tokenIn),
    to: symOf(r.tokenOut),
    amountIn: r.amountIn.toString(),
    expectedOut: r.expectedOut.toString(),
    minOut: r.minOut.toString(),
    rate: rateString(r.tokenIn, r.amountIn, r.tokenOut, r.expectedOut),
    vsOfficial: savings ? { pct: savings.bps / 100, pair: savings.pair, deltaOut: savings.delta } : null,
    vsWesternUnion: vsWesternUnion(symOf(r.tokenIn), symOf(r.tokenOut), r.amountIn, r.expectedOut, q.references),
    steps: r.legs.length,
    venues: venuesOf(r),
    usesTextile: r.legs.some((l) => l.quote.venue !== "uniswap_v3"),
    alternatives: q.alternatives.slice(0, 5).map((a) => ({
      expectedOut: a.expectedOut.toString(),
      venues: venuesOf(a),
      diffBps: r.expectedOut === 0n ? 0 : Number(((a.expectedOut - r.expectedOut) * 10_000n) / r.expectedOut),
    })),
    references: q.references.map(({ name, pair, rate, source, at }) => ({ name, pair, rate, source, at })),
  };
}

/**
 * GET /quotes/open?account=: the newest unsigned intent retained for 15 minutes. Expired prices
 * stay expired: the app asks for a fresh quote before the user can confirm.
 */
export async function openQuote(deps: MiniappDeps, account: Address): Promise<{ quote: z.infer<typeof QuoteResponse> | null }> {
  const row = await deps.store().latestOpenQuote(account.toLowerCase(), new Date(deps.now()));
  if (!row) return { quote: null };
  return { quote: toQuoteResponse(row, decodePayload(row.payload)) };
}

/** POST /quote: plan, store the quote (≈60 s) and map it to the contract. */
export async function createQuote(deps: MiniappDeps, req: z.infer<typeof QuoteRequest>, intent?: { recipient: string }): Promise<z.infer<typeof QuoteResponse>> {
  const account = req.account ? (req.account.toLowerCase() as Address) : undefined;
  const exact = req.amountOut !== undefined;
  const q = exact ? await planExactOut(deps, req.from, req.to, parseAmount(req.to, req.amountOut!), account) : await planQuote(deps, req.from, req.to, parseAmount(req.from, req.amount ?? "0"), account);
  const recipient = intent?.recipient ?? req.recipient;
  const row = await deps.store().insertQuote({
    account: account ?? null,
    fromSym: req.from,
    toSym: req.to,
    amountIn: q.route.amountIn.toString(),
    payload: encodePayload({ ...q, lang: req.lang ?? null, sendRecipient: recipient?.toLowerCase(), ...(exact ? { exactOut: true as const } : {}) }),
    expiresAt: new Date(deps.now() + QUOTE_TTL_MS),
  });
  return toQuoteResponse(row, q);
}

/** GET /quote/:id: one of the account's own quotes (any status), for a link that opens it. */
export async function quoteById(deps: MiniappDeps, id: string, account: Address): Promise<z.infer<typeof QuoteResponse>> {
  const row = await deps.store().getQuote(id.toLowerCase());
  if (!row || row.account?.toLowerCase() !== account.toLowerCase()) throw notFound("Quote not found.");
  return toQuoteResponse(row, decodePayload(row.payload));
}
