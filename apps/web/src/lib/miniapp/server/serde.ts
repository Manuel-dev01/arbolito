import type { Quote, Reference, Route } from "@arbolito/router";

/** Routes cross Postgres jsonb, so bigints travel as decimal strings (mirrors apps/agent/src/serde.ts). */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export const toJson = (v: unknown): Json => {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, toJson(x)]));
  return v as Json;
};

export function quoteFromJson(j: Json): Quote {
  const q = j as Record<string, Json>;
  return {
    ...(q as unknown as Quote),
    amountIn: BigInt(q.amountIn as string),
    amountOut: BigInt(q.amountOut as string),
    blockNumber: BigInt(q.blockNumber as string),
  };
}

export function routeFromJson(j: Json): Route {
  const r = j as Record<string, Json>;
  return {
    ...(r as unknown as Route),
    amountIn: BigInt(r.amountIn as string),
    expectedOut: BigInt(r.expectedOut as string),
    minOut: BigInt(r.minOut as string),
    legs: (r.legs as Record<string, Json>[]).map((l) => ({ quote: quoteFromJson(l.quote!), minOut: BigInt(l.minOut as string) })),
  };
}

/** What a miniapp_quotes row stores in `payload`. */
export interface QuotePayload {
  v: 1;
  route: Json;
  alternatives: Json[];
  quotesConsidered: Json[];
  references: Reference[];
  blockNumber: string;
  lang: string | null;
}

export interface DecodedPayload {
  route: Route;
  alternatives: Route[];
  quotesConsidered: Quote[];
  references: Reference[];
  blockNumber: bigint;
}

export function encodePayload(p: DecodedPayload & { lang?: string | null }): QuotePayload {
  return {
    v: 1,
    route: toJson(p.route),
    alternatives: p.alternatives.map(toJson),
    quotesConsidered: p.quotesConsidered.map(toJson),
    references: p.references,
    blockNumber: p.blockNumber.toString(),
    lang: p.lang ?? null,
  };
}

export function decodePayload(raw: unknown): DecodedPayload {
  const p = raw as QuotePayload;
  if (!p || p.v !== 1) throw new Error("unknown quote payload version");
  return {
    route: routeFromJson(p.route),
    alternatives: p.alternatives.map(routeFromJson),
    quotesConsidered: p.quotesConsidered.map(quoteFromJson),
    references: p.references,
    blockNumber: BigInt(p.blockNumber),
  };
}
