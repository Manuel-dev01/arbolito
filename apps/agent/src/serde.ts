import type { Quote, Route } from "@arbolito/router";

/** Routes cross Postgres jsonb, so bigints travel as decimal strings. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const toJson = (v: unknown): Json => {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]));
  return v as Json;
};

export const serializeRoute = (r: Route): Json => toJson(r);

function quoteFromJson(q: Record<string, Json>): Quote {
  return {
    ...(q as unknown as Quote),
    amountIn: BigInt(q.amountIn as string),
    amountOut: BigInt(q.amountOut as string),
    blockNumber: BigInt(q.blockNumber as string),
  };
}

export function deserializeRoute(j: Json): Route {
  const r = j as Record<string, Json>;
  return {
    ...(r as unknown as Route),
    amountIn: BigInt(r.amountIn as string),
    expectedOut: BigInt(r.expectedOut as string),
    minOut: BigInt(r.minOut as string),
    legs: (r.legs as Record<string, Json>[]).map((l) => ({
      quote: quoteFromJson(l.quote as Record<string, Json>),
      minOut: BigInt(l.minOut as string),
    })),
  };
}
