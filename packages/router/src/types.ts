import type { Address, Hex } from "viem";

export type Venue = "textile_rfq" | "uniswap_v3" | "textile_limit";

/** One venue's answer for one leg. Amounts are atomic units. */
export interface Quote {
  venue: Venue;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  /** Unix seconds. Uniswap quotes have no expiry; firm RFQ quotes do. */
  expiresAt?: number;
  blockNumber: bigint;
  firm: boolean;
  /** Full venue payload (QuoterV2 outputs, maker signature, …) kept for the ProofBundle. */
  raw: unknown;
  /** Venue-specific routing details (e.g. Uniswap pool and fee tier). */
  meta?: { pool?: Address; fee?: number };
}

export interface Leg {
  quote: Quote;
  minOut: bigint;
}

export interface Route {
  id: string;
  /** Human label, e.g. "wBRL →(uniswap 0.01%) USDT →(uniswap 0.01%) wARS". */
  label: string;
  legs: Leg[];
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  expectedOut: bigint;
  /** Final-leg minimum after slippage. */
  minOut: bigint;
  taker: Address;
}

export interface Call {
  to: Address;
  data: Hex;
  value: bigint;
  /** What the call does, for logs and receipts. */
  label: string;
}

export interface QuoteParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  taker: Address;
  blockNumber: bigint;
}

export interface VenueAdapter {
  venue: Venue;
  /** Null when the venue can't quote this pair/size (no pool, no_quote, disabled). */
  quote(p: QuoteParams): Promise<Quote | null>;
}

export interface Reference {
  /** western_union: read in a browser rented through buy (packages/competitors); the source names the payment. */
  name: "official" | "mep" | "ccl" | "crypto" | "blue" | "textile_mid" | "uniswap_mid" | "western_union";
  /** Quote convention BASE/QUOTE: units of QUOTE per 1 BASE, e.g. "USD/ARS" = 1545. */
  pair: string;
  rate: string;
  source: string;
  at: string;
}
