import type { Hex } from "viem";
import { tokenByAddress } from "@arbolito/config";
import { fiatOf, referenceRate, type Quote, type Reference, type Route } from "@arbolito/router";
import { jsonSafe } from "./canonical";
import { proofBundleSchema, type ProofBundle } from "./schema";

export interface BuildBundleArgs {
  route: Route;
  alternatives: Route[];
  quotesConsidered: Quote[];
  references: Reference[];
  execution: { txHash: Hex; blockNumber: bigint; amountOut: bigint; attribution: string[] };
  createdAt?: Date;
  competitor?: ProofBundle["competitor"];
}

const RATE_SCALE = 10n ** 12n;

/** Savings vs the official rate for the route's pair (tokenOut atomic units). */
export function savingsVsOfficial(route: Route, executedOut: bigint, references: Reference[]): ProofBundle["savings"] {
  const tin = tokenByAddress(route.tokenIn);
  const tout = tokenByAddress(route.tokenOut);
  const base = fiatOf(tin.symbol);
  const quote = fiatOf(tout.symbol);
  const rate = referenceRate(references, "official", base, quote);
  if (!rate) return undefined;
  const scaled = BigInt(Math.round(rate * Number(RATE_SCALE)));
  const dec = tout.decimals - tin.decimals;
  let referenceOut = (route.amountIn * scaled) / RATE_SCALE;
  referenceOut = dec >= 0 ? referenceOut * 10n ** BigInt(dec) : referenceOut / 10n ** BigInt(-dec);
  if (referenceOut === 0n) return undefined;
  const delta = executedOut - referenceOut;
  return {
    vs: "official",
    pair: `${base}/${quote}`,
    referenceOut: referenceOut.toString(),
    executedOut: executedOut.toString(),
    delta: delta.toString(),
    bps: Number((delta * 10_000n) / referenceOut),
  };
}

/** Builds and validates a ProofBundle. All bigints become decimal strings. */
export function buildBundle(a: BuildBundleArgs): ProofBundle {
  const bundle = {
    v: 1,
    routeId: a.route.id,
    createdAt: (a.createdAt ?? new Date()).toISOString(),
    chainId: 42220,
    request: { tokenIn: a.route.tokenIn, tokenOut: a.route.tokenOut, amountIn: a.route.amountIn.toString(), taker: a.route.taker },
    quotesConsidered: jsonSafe(a.quotesConsidered),
    chosen: jsonSafe(a.route),
    alternatives: jsonSafe(a.alternatives),
    references: a.references,
    savings: savingsVsOfficial(a.route, a.execution.amountOut, a.references),
    competitor: a.competitor,
    execution: {
      txHash: a.execution.txHash,
      blockNumber: a.execution.blockNumber.toString(),
      amountOut: a.execution.amountOut.toString(),
      attribution: a.execution.attribution,
    },
  };
  return proofBundleSchema.parse(bundle);
}
