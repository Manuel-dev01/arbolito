import { randomUUID } from "node:crypto";
import type { Address, PublicClient } from "viem";
import { TOKENS, tokenByAddress } from "@arbolito/config";
import { applySlippage, buildUniswapCalls } from "./uniswap/adapter";
import type { Call, Leg, Quote, Route, VenueAdapter } from "./types";

export const DEFAULT_SLIPPAGE_BPS = 50;

export interface PlanParams {
  client: PublicClient;
  adapters: VenueAdapter[];
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  taker: Address;
  slippageBps?: number;
  /** Pin all quotes to one block. Defaults to the latest. */
  blockNumber?: bigint;
  /** Intermediate token for two-hop routes. Defaults to USDT, the hub of every Celo LatAm pool. */
  hub?: Address;
}

export interface VenueError {
  venue: string;
  tokenIn: string;
  tokenOut: string;
  error: string;
}

export interface PlanResult {
  best: Route | null;
  /** Every other complete route, best first. */
  alternatives: Route[];
  /** Every quote any venue returned, including legs of routes that lost. */
  quotesConsidered: Quote[];
  blockNumber: bigint;
  venueErrors: VenueError[];
}

const sym = (a: Address) => tokenByAddress(a).symbol;
const venueTag = (q: Quote) =>
  q.venue === "uniswap_v3" && q.meta?.fee !== undefined ? `uniswap ${(q.meta.fee / 10_000).toFixed(2)}%` : q.venue;

export function routeLabel(legs: Leg[]): string {
  return [sym(legs[0]!.quote.tokenIn), ...legs.map((l) => `→[${venueTag(l.quote)}] ${sym(l.quote.tokenOut)}`)].join(" ");
}

/** Candidate token paths: direct, and via the hub when neither end is the hub. */
export function candidatePaths(tokenIn: Address, tokenOut: Address, hub: Address): Address[][] {
  const eq = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();
  if (eq(tokenIn, tokenOut)) throw new Error("tokenIn and tokenOut are the same");
  const paths: Address[][] = [[tokenIn, tokenOut]];
  if (!eq(tokenIn, hub) && !eq(tokenOut, hub)) paths.push([tokenIn, hub, tokenOut]);
  return paths;
}

export async function plan(p: PlanParams): Promise<PlanResult> {
  const slippageBps = p.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const blockNumber = p.blockNumber ?? (await p.client.getBlockNumber());
  const hub = p.hub ?? TOKENS.USDT.address;
  const quotesConsidered: Quote[] = [];
  const venueErrors: VenueError[] = [];

  const quoteLeg = async (tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<Quote[]> => {
    const results = await Promise.all(
      p.adapters.map(async (a) => {
        try {
          return await a.quote({ tokenIn, tokenOut, amountIn, taker: p.taker, blockNumber });
        } catch (err) {
          venueErrors.push({ venue: a.venue, tokenIn: sym(tokenIn), tokenOut: sym(tokenOut), error: (err as Error).message });
          return null;
        }
      }),
    );
    const ok = results.filter((q): q is Quote => q !== null);
    quotesConsidered.push(...ok);
    return ok;
  };

  // Expand a token path into every venue combination, chaining exact amounts leg to leg.
  const expand = async (path: Address[], hop: number, amountIn: bigint, prefix: Quote[]): Promise<Quote[][]> => {
    if (hop === path.length - 1) return [prefix];
    const quotes = await quoteLeg(path[hop]!, path[hop + 1]!, amountIn);
    const branches = await Promise.all(quotes.map((q) => expand(path, hop + 1, q.amountOut, [...prefix, q])));
    return branches.flat();
  };

  const combos = (await Promise.all(candidatePaths(p.tokenIn, p.tokenOut, hub).map((path) => expand(path, 0, p.amountIn, [])))).flat();

  const routes: Route[] = combos
    .filter((qs) => qs.length > 0)
    .map((qs) => {
      const legs: Leg[] = qs.map((quote) => ({ quote, minOut: applySlippage(quote.amountOut, slippageBps) }));
      const expectedOut = qs[qs.length - 1]!.amountOut;
      return {
        id: randomUUID(),
        label: routeLabel(legs),
        legs,
        tokenIn: p.tokenIn,
        tokenOut: p.tokenOut,
        amountIn: p.amountIn,
        expectedOut,
        minOut: applySlippage(expectedOut, slippageBps),
        taker: p.taker,
      };
    })
    .sort((a, b) => (b.expectedOut > a.expectedOut ? 1 : b.expectedOut < a.expectedOut ? -1 : 0));

  return { best: routes[0] ?? null, alternatives: routes.slice(1), quotesConsidered, blockNumber, venueErrors };
}

const isAllUniswap = (route: Route) => route.legs.every((l) => l.quote.venue === "uniswap_v3");

/**
 * Routes that can execute today, best first. All-Uniswap routes always can. Routes with
 * Textile legs need a firm quote at execution time (taker-funded, inventory-locking), which
 * is opt-in until it has run on mainnet: pass textileFirm = textileFirmEnabled().
 */
export function executableRoutes(result: Pick<PlanResult, "best" | "alternatives">, opts: { textileFirm: boolean }): Route[] {
  const all = result.best ? [result.best, ...result.alternatives] : [];
  return all.filter((r) => isAllUniswap(r) || opts.textileFirm);
}

/** Static calls for an all-Uniswap route (approve + one atomic swap). */
export function buildRouteCalls(route: Route, recipient: Address): Call[] {
  if (isAllUniswap(route)) return buildUniswapCalls(route.legs, recipient, route.minOut);
  throw new Error("Textile legs execute from a firm quote taken at execution time, not from static calls");
}
