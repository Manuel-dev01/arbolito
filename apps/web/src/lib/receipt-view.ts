import { tokenByAddress } from "@arbolito/config";
import type { ProofBundle } from "@arbolito/proof";
import { applyRate, fiatOfSymbol, parseDecimal, rateOf, RATE_ONE } from "./format";

/**
 * Turns a ProofBundle into what the receipt page shows. Amounts stay bigint (atomic units);
 * formatting happens in the components.
 */

export interface TokenRef {
  address: string;
  symbol: string;
  decimals: number;
  /** Fiat the token tracks (USD, ARS, BRL, …). */
  fiat: string;
}

export type ReferenceName = ProofBundle["references"][number]["name"];

export interface Comparison {
  name: ReferenceName;
  /** BASE/QUOTE of the route, e.g. BRL/ARS. */
  pair: string;
  /** Set when the rate is a cross through USD: the reference used for the USD leg ("USD/BRL uniswap_mid"). */
  via?: { name: ReferenceName; pair: string };
  /** QUOTE per 1 BASE, 1e18-scaled. */
  rate: bigint;
  /** What amountIn would have bought at this rate, in tokenOut atomic units. */
  referenceOut: bigint;
  /** executed − referenceOut (positive = the user got more). */
  delta: bigint;
  bps: number;
  source: string;
  at: string;
}

export interface StepView {
  from: TokenRef;
  to: TokenRef;
  venue: ProofBundle["quotesConsidered"][number]["venue"];
  /** Uniswap fee tier in hundredths of a bip (100 = 0.01%). */
  fee?: number;
  pool?: string;
  firm: boolean;
  amountIn: bigint;
  amountOut: bigint;
}

export interface RouteView {
  id: string;
  label: string;
  steps: StepView[];
  expectedOut: bigint;
  minOut: bigint;
}

export interface AlternativeView extends RouteView {
  /** alternative expectedOut − chosen expectedOut. */
  diffVsChosen: bigint;
  diffBps: number;
}

export interface ReceiptView {
  routeId: string;
  createdAt: string;
  taker: string;
  /** Set on a send: the contact who received amountOut (taker is the sender). */
  recipient?: string;
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  amountIn: bigint;
  /** Delivered onchain (execution.amountOut). */
  amountOut: bigint;
  /** QUOTE fiat per 1 BASE fiat, 1e18-scaled. */
  rate: bigint;
  savings?: { pair: string; referenceOut: bigint; executedOut: bigint; delta: bigint; bps: number };
  comparisons: Comparison[];
  chosen: RouteView;
  alternatives: AlternativeView[];
  quotesConsidered: number;
  /** USD notional of the route in micro-USD, if it can be derived. */
  usdMicros?: bigint;
  execution: { txHash: string; blockNumber: bigint; attribution: string[] };
}

export function tokenRef(address: string): TokenRef {
  try {
    const t = tokenByAddress(address);
    return { address: t.address, symbol: t.symbol, decimals: t.decimals, fiat: fiatOfSymbol(t.symbol) };
  } catch {
    return { address, symbol: `${address.slice(0, 6)}…`, decimals: 18, fiat: "?" };
  }
}

const COMPARE_ORDER: ReferenceName[] = ["official", "mep", "ccl", "crypto", "blue", "western_union", "uniswap_mid", "textile_mid"];
const USD_BRIDGES: ReferenceName[] = ["uniswap_mid", "textile_mid", "official"];

type Ref = ProofBundle["references"][number];

const bps = (delta: bigint, base: bigint) => (base === 0n ? 0 : Number((delta * 10_000n) / base));

/** Reference rate for BASE/QUOTE under `name`: direct, inverse, or a cross through USD. */
export function resolveRate(
  refs: Ref[],
  name: ReferenceName,
  base: string,
  quote: string,
): { rate: bigint; ref: Ref; via?: { name: ReferenceName; pair: string } } | undefined {
  const find = (n: ReferenceName, pair: string) => refs.find((r) => r.name === n && r.pair === pair);
  const direct = find(name, `${base}/${quote}`);
  if (direct) return { rate: parseDecimal(direct.rate), ref: direct };
  const inverse = find(name, `${quote}/${base}`);
  if (inverse) {
    const r = parseDecimal(inverse.rate);
    return r === 0n ? undefined : { rate: (RATE_ONE * RATE_ONE) / r, ref: inverse };
  }
  if (base !== "USD" && quote !== "USD") {
    const usdQuote = find(name, `USD/${quote}`);
    if (!usdQuote) return undefined;
    for (const bridgeName of [name, ...USD_BRIDGES]) {
      const usdBase = find(bridgeName, `USD/${base}`);
      if (!usdBase) continue;
      const b = parseDecimal(usdBase.rate);
      if (b === 0n) continue;
      return { rate: (parseDecimal(usdQuote.rate) * RATE_ONE) / b, ref: usdQuote, via: { name: bridgeName, pair: `USD/${base}` } };
    }
  }
  return undefined;
}

export function compareToReferences(
  refs: Ref[],
  tokenIn: TokenRef,
  tokenOut: TokenRef,
  amountIn: bigint,
  executedOut: bigint,
): Comparison[] {
  const out: Comparison[] = [];
  for (const name of COMPARE_ORDER) {
    const hit = resolveRate(refs, name, tokenIn.fiat, tokenOut.fiat);
    if (!hit) continue;
    // Western Union is read for USD → ARS/BRL only; an inverse or cross of it is a rate it never offered.
    if (name === "western_union" && (tokenIn.fiat !== "USD" || hit.via || hit.ref.pair !== `${tokenIn.fiat}/${tokenOut.fiat}`)) continue;
    const referenceOut = applyRate(amountIn, tokenIn.decimals, hit.rate, tokenOut.decimals);
    const delta = executedOut - referenceOut;
    out.push({
      name,
      pair: `${tokenIn.fiat}/${tokenOut.fiat}`,
      via: hit.via,
      rate: hit.rate,
      referenceOut,
      delta,
      bps: bps(delta, referenceOut),
      source: hit.ref.source,
      at: hit.ref.at,
    });
  }
  return out;
}

function routeView(r: ProofBundle["chosen"]): RouteView {
  return {
    id: r.id,
    label: r.label,
    expectedOut: BigInt(r.expectedOut),
    minOut: BigInt(r.minOut),
    steps: r.legs.map((l) => ({
      from: tokenRef(l.quote.tokenIn),
      to: tokenRef(l.quote.tokenOut),
      venue: l.quote.venue,
      fee: l.quote.meta?.fee,
      pool: l.quote.meta?.pool,
      firm: l.quote.firm,
      amountIn: BigInt(l.quote.amountIn),
      amountOut: BigInt(l.quote.amountOut),
    })),
  };
}

const toMicros = (amount: bigint, decimals: number) =>
  decimals >= 6 ? amount / 10n ** BigInt(decimals - 6) : amount * 10n ** BigInt(6 - decimals);

/**
 * USD notional of a route: the USD side of the request if there is one, else the first USD leg
 * of the chosen route (e.g. wBRL→USDT→wARS), else the market mid for USD/fiatIn.
 */
export function usdNotionalMicros(bundle: ProofBundle): bigint | undefined {
  const tin = tokenRef(bundle.request.tokenIn);
  const tout = tokenRef(bundle.request.tokenOut);
  if (tin.fiat === "USD") return toMicros(BigInt(bundle.request.amountIn), tin.decimals);
  if (tout.fiat === "USD") return toMicros(BigInt(bundle.execution.amountOut), tout.decimals);
  for (const leg of bundle.chosen.legs) {
    const a = tokenRef(leg.quote.tokenIn);
    if (a.fiat === "USD") return toMicros(BigInt(leg.quote.amountIn), a.decimals);
    const b = tokenRef(leg.quote.tokenOut);
    if (b.fiat === "USD") return toMicros(BigInt(leg.quote.amountOut), b.decimals);
  }
  for (const name of USD_BRIDGES) {
    const hit = resolveRate(bundle.references, name, tin.fiat, "USD");
    if (hit) return toMicros(applyRate(BigInt(bundle.request.amountIn), tin.decimals, hit.rate, 6), 6);
  }
  return undefined;
}

export function buildReceiptView(bundle: ProofBundle): ReceiptView {
  const tokenIn = tokenRef(bundle.request.tokenIn);
  const tokenOut = tokenRef(bundle.request.tokenOut);
  const amountIn = BigInt(bundle.request.amountIn);
  const amountOut = BigInt(bundle.execution.amountOut);
  const chosen = routeView(bundle.chosen);
  const seen = new Set([chosen.id]);
  const alternatives: AlternativeView[] = [];
  for (const alt of bundle.alternatives) {
    if (seen.has(alt.id)) continue;
    seen.add(alt.id);
    const v = routeView(alt);
    const diff = v.expectedOut - chosen.expectedOut;
    alternatives.push({ ...v, diffVsChosen: diff, diffBps: bps(diff, chosen.expectedOut) });
  }
  const s = bundle.savings;
  return {
    routeId: bundle.routeId,
    createdAt: bundle.createdAt,
    taker: bundle.request.taker,
    recipient: bundle.request.recipient ?? undefined,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    rate: rateOf(amountIn, tokenIn.decimals, amountOut, tokenOut.decimals),
    savings: s
      ? { pair: s.pair, referenceOut: BigInt(s.referenceOut), executedOut: BigInt(s.executedOut), delta: BigInt(s.delta), bps: s.bps }
      : undefined,
    comparisons: compareToReferences(bundle.references, tokenIn, tokenOut, amountIn, amountOut),
    chosen,
    alternatives,
    quotesConsidered: bundle.quotesConsidered.length,
    usdMicros: usdNotionalMicros(bundle),
    execution: { txHash: bundle.execution.txHash, blockNumber: BigInt(bundle.execution.blockNumber), attribution: bundle.execution.attribution },
  };
}
