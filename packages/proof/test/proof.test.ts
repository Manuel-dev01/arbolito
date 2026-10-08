import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes, zeroAddress } from "viem";
import { TOKENS } from "@arbolito/config";
import type { Quote, Reference, Route } from "@arbolito/router";
import {
  buildBundle,
  bundleHash,
  bytes32ToRouteId,
  canonicalize,
  jsonSafe,
  proofBundleSchema,
  routeIdToBytes32,
  savingsVsOfficial,
} from "../src";

describe("canonicalize", () => {
  it("sorts keys and strips whitespace", () => {
    expect(canonicalize({ b: 1, a: [true, null, "x"], c: { z: 0, y: "é" } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":"é","z":0}}');
  });
  it("matches RFC 8785 number and string serialization", () => {
    expect(canonicalize([1e21, 0.1, -0, 1.5e-7, "\u2028", "\"q\""])).toBe('[1e+21,0.1,0,1.5e-7,"\u2028","\\"q\\""]');
  });
  it("sorts keys by UTF-16 code units", () => {
    expect(canonicalize({ "\u20ac": 1, "\r": 2, "1": 3, a: 4, A: 5 })).toBe('{"\\r":2,"1":3,"A":5,"a":4,"\u20ac":1}');
  });
  it("is independent of key insertion order", () => {
    expect(canonicalize({ x: 1, y: { b: 2, a: 1 } })).toBe(canonicalize({ y: { a: 1, b: 2 }, x: 1 }));
  });
  it("rejects bigint, NaN and undefined array members; drops undefined members", () => {
    expect(() => canonicalize({ a: 1n })).toThrow(/bigint/);
    expect(() => canonicalize([Number.NaN])).toThrow(/non-finite/);
    expect(() => canonicalize([undefined])).toThrow(/undefined/);
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
  it("jsonSafe converts nested bigints to decimal strings", () => {
    expect(jsonSafe({ a: 1n, b: [2n, { c: 3n }] })).toEqual({ a: "1", b: ["2", { c: "3" }] });
  });
});

describe("routeId encoding", () => {
  it("round-trips a UUID through bytes32", () => {
    const id = "3f2c1a9e-8b7d-4c6e-9f10-112233445566";
    const b = routeIdToBytes32(id);
    expect(b).toBe("0x000000000000000000000000000000003f2c1a9e8b7d4c6e9f10112233445566");
    expect(bytes32ToRouteId(b)).toBe(id);
  });
  it("rejects non-UUID ids", () => {
    expect(() => routeIdToBytes32("route-1")).toThrow();
  });
});

const { wBRL, wARS, USDT } = TOKENS;
const q1: Quote = {
  venue: "uniswap_v3",
  tokenIn: wBRL.address,
  tokenOut: USDT.address,
  amountIn: 200n * 10n ** 18n,
  amountOut: 39_728_611n,
  blockNumber: 79_492_714n,
  firm: false,
  raw: { gasEstimate: 95_463n },
  meta: { pool: "0x01c3cf91cdf7B34181C7eC8566c0236951FEA40F", fee: 100 },
};
const q2: Quote = { ...q1, tokenIn: USDT.address, tokenOut: wARS.address, amountIn: 39_728_611n, amountOut: 63_729_206_410_000_000_000_000n, meta: { fee: 100 } };
const route: Route = {
  id: "3f2c1a9e-8b7d-4c6e-9f10-112233445566",
  label: "wBRL →[uniswap 0.01%] USDT →[uniswap 0.01%] wARS",
  legs: [
    { quote: q1, minOut: 39_529_967n },
    { quote: q2, minOut: 63_410_560_400_000_000_000_000n },
  ],
  tokenIn: wBRL.address,
  tokenOut: wARS.address,
  amountIn: 200n * 10n ** 18n,
  expectedOut: q2.amountOut,
  minOut: 63_410_560_400_000_000_000_000n,
  taker: zeroAddress,
};
const refs: Reference[] = [
  { name: "official", pair: "BRL/ARS", rate: "304.3467", source: "https://dolarapi.com/v1/cotizaciones#BRL.oficial.venta", at: "2026-10-07T12:52:00.000Z" },
  { name: "official", pair: "USD/ARS", rate: "1545", source: "https://dolarapi.com/v1/dolares#oficial.venta", at: "2026-10-07T13:00:00.000Z" },
];
const execution = {
  txHash: `0x${"ab".repeat(32)}` as const,
  blockNumber: 79_492_716n,
  amountOut: 63_700_000_000_000_000_000_000n,
  attribution: ["arbolito_fork"],
};

describe("buildBundle", () => {
  const bundle = buildBundle({ route, alternatives: [], quotesConsidered: [q1, q2], references: refs, execution, createdAt: new Date("2026-10-08T10:00:00Z") });

  it("produces a schema-valid bundle with bigints as decimal strings", () => {
    expect(proofBundleSchema.safeParse(bundle).success).toBe(true);
    expect(bundle.chosen.amountIn).toBe("200000000000000000000");
    expect((bundle.quotesConsidered[0]!.raw as { gasEstimate: string }).gasEstimate).toBe("95463");
  });

  it("hashes the canonical JSON with keccak256, stable across key order", () => {
    const h = bundleHash(bundle);
    expect(h).toBe(keccak256(stringToBytes(canonicalize(bundle))));
    const reordered = JSON.parse(JSON.stringify(bundle, Object.keys(bundle).reverse()));
    const roundTrip = proofBundleSchema.parse(JSON.parse(JSON.stringify(bundle)));
    expect(bundleHash(roundTrip)).toBe(h);
    expect(Object.keys(reordered)[0]).not.toBe(Object.keys(bundle)[0]);
  });

  it("changes the hash when any field changes", () => {
    const tampered = { ...bundle, execution: { ...bundle.execution, amountOut: "1" } };
    expect(bundleHash(tampered)).not.toBe(bundleHash(bundle));
  });

  it("computes savings vs the official BRL/ARS rate", () => {
    // reference: 200 × 304.3467 = 60,869.34 wARS; executed 63,700 → +2,830.66 (≈ +465 bps)
    expect(bundle.savings!.pair).toBe("BRL/ARS");
    expect(bundle.savings!.referenceOut).toBe("60869340000000000000000");
    expect(bundle.savings!.delta).toBe("2830660000000000000000");
    expect(bundle.savings!.bps).toBe(465);
  });

  it("omits savings when no official reference exists for the pair", () => {
    expect(savingsVsOfficial(route, execution.amountOut, [])).toBeUndefined();
  });
});
