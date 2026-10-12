import { formatUnits, zeroAddress, type Address } from "viem";
import type { z } from "zod";
import { TOKENS, tokenByAddress } from "@arbolito/config";
import { savingsVsOfficial } from "@arbolito/proof";
import { plan, toAtomic, type Quote, type Reference, type Route } from "@arbolito/router";
import { SYMBOLS, type QuoteRequest, type QuoteResponse, type Sym } from "../contract";
import type { MiniappDeps } from "./deps";
import { badRequest, noRoute } from "./errors";
import { encodePayload } from "./serde";
import type { QuoteRow } from "./store";

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
  const route = all.find((r) => isMiniPayExecutable(r, deps.textileEnabled));
  if (!route) throw noRoute();
  return {
    route,
    alternatives: all.filter((r) => r !== route),
    quotesConsidered: planned.quotesConsidered,
    references: refs.references,
    blockNumber,
  };
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

/** POST /quote: plan, store the quote (≈60 s) and map it to the contract. */
export async function createQuote(deps: MiniappDeps, req: z.infer<typeof QuoteRequest>): Promise<z.infer<typeof QuoteResponse>> {
  const amountIn = parseAmount(req.from, req.amount);
  const account = req.account ? (req.account.toLowerCase() as Address) : undefined;
  const q = await planQuote(deps, req.from, req.to, amountIn, account);
  const row = await deps.store().insertQuote({
    account: account ?? null,
    fromSym: req.from,
    toSym: req.to,
    amountIn: amountIn.toString(),
    payload: encodePayload({ ...q, lang: req.lang ?? null }),
    expiresAt: new Date(deps.now() + QUOTE_TTL_MS),
  });
  return toQuoteResponse(row, q);
}
