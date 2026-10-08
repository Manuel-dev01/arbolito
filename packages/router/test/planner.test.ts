import { describe, expect, it } from "vitest";
import { decodeFunctionData, zeroAddress, type Address, type PublicClient } from "viem";
import { CONTRACTS, TOKENS } from "@arbolito/config";
import {
  applySlippage,
  buildRouteCalls,
  candidatePaths,
  encodePath,
  fmtAmount,
  plan,
  priceFromSqrtX96,
  swapRouter02Abi,
  toAtomic,
  type Quote,
  type QuoteParams,
  type VenueAdapter,
} from "../src";

const { wBRL, wARS, USDT, USAT } = TOKENS;
const client = {} as PublicClient; // planner only touches the client when blockNumber is omitted

/** Fake venue: fixed rates (out per in, as a decimal-adjusted ratio) per directed pair. */
function fakeVenue(venue: Quote["venue"], rates: Record<string, number>, fee = 100): VenueAdapter {
  return {
    venue,
    async quote(p: QuoteParams) {
      const r = rates[`${p.tokenIn}-${p.tokenOut}`];
      if (r === undefined) return null;
      const decIn = Object.values(TOKENS).find((t) => t.address === p.tokenIn)!.decimals;
      const decOut = Object.values(TOKENS).find((t) => t.address === p.tokenOut)!.decimals;
      // amountOut = amountIn * r * 10^(decOut - decIn), in integer math with 1e9 rate precision
      const scaled = (p.amountIn * BigInt(Math.round(r * 1e9))) / 1_000_000_000n;
      const amountOut = decOut >= decIn ? scaled * 10n ** BigInt(decOut - decIn) : scaled / 10n ** BigInt(decIn - decOut);
      return {
        venue,
        tokenIn: p.tokenIn,
        tokenOut: p.tokenOut,
        amountIn: p.amountIn,
        amountOut,
        blockNumber: p.blockNumber,
        firm: venue === "textile_rfq",
        raw: { fake: true },
        meta: venue === "uniswap_v3" ? { fee } : undefined,
      };
    },
  };
}
const k = (a: Address, b: Address) => `${a}-${b}`;

describe("candidatePaths", () => {
  it("adds a USDT two-hop when neither end is USDT", () => {
    expect(candidatePaths(wBRL.address, wARS.address, USDT.address)).toEqual([
      [wBRL.address, wARS.address],
      [wBRL.address, USDT.address, wARS.address],
    ]);
  });
  it("is direct-only when one end is the hub", () => {
    expect(candidatePaths(USDT.address, wARS.address, USDT.address)).toEqual([[USDT.address, wARS.address]]);
  });
  it("rejects same-token requests", () => {
    expect(() => candidatePaths(wARS.address, wARS.address, USDT.address)).toThrow();
  });
});

describe("plan", () => {
  const amountIn = toAtomic(wBRL.address, "200");

  it("chains exact amounts across legs and picks the highest expectedOut", async () => {
    const uni = fakeVenue("uniswap_v3", { [k(wBRL.address, USDT.address)]: 0.2, [k(USDT.address, wARS.address)]: 1600 });
    const tex = fakeVenue("textile_rfq", { [k(wBRL.address, USDT.address)]: 0.19, [k(USDT.address, wARS.address)]: 1610 });
    const r = await plan({ client, adapters: [uni, tex], tokenIn: wBRL.address, tokenOut: wARS.address, amountIn, taker: zeroAddress, blockNumber: 1n });

    // 2 venues × 2 venues on the only path (no direct wBRL/wARS venue)
    expect(r.alternatives.length + 1).toBe(4);
    // best: uniswap leg 1 (0.2) then textile leg 2 (1610) → 200 × 0.2 × 1610 = 64,400
    expect(r.best!.label).toBe("wBRL →[uniswap 0.01%] USDT →[textile_rfq] wARS");
    expect(r.best!.expectedOut).toBe(toAtomic(wARS.address, "64400"));
    // leg 2 was quoted with leg 1's exact output (40 USDT)
    expect(r.best!.legs[1]!.quote.amountIn).toBe(r.best!.legs[0]!.quote.amountOut);
    expect(r.best!.legs[0]!.quote.amountOut).toBe(toAtomic(USDT.address, "40"));
    // alternatives are sorted, worst last
    const outs = [r.best!, ...r.alternatives].map((x) => x.expectedOut);
    expect([...outs].sort((a, b) => (b > a ? 1 : -1))).toEqual(outs);
    // every leg quote is kept for the ProofBundle: 2 (leg 1) + 2×2 (leg 2)
    expect(r.quotesConsidered).toHaveLength(6);
  });

  it("prefers a direct route when it beats the two-hop", async () => {
    const uni = fakeVenue("uniswap_v3", {
      [k(USAT.address, USDT.address)]: 0.999,
      [k(USDT.address, wARS.address)]: 1600,
      [k(USAT.address, wARS.address)]: 1605,
    });
    const r = await plan({ client, adapters: [uni], tokenIn: USAT.address, tokenOut: wARS.address, amountIn: 100_000_000n, taker: zeroAddress, blockNumber: 1n });
    expect(r.best!.legs).toHaveLength(1);
    expect(r.alternatives[0]!.legs).toHaveLength(2);
  });

  it("records venue errors without failing the plan", async () => {
    const uni = fakeVenue("uniswap_v3", { [k(wBRL.address, USDT.address)]: 0.2, [k(USDT.address, wARS.address)]: 1600 });
    const broken: VenueAdapter = { venue: "textile_rfq", quote: async () => { throw new Error("no_quote"); } };
    const r = await plan({ client, adapters: [uni, broken], tokenIn: wBRL.address, tokenOut: wARS.address, amountIn, taker: zeroAddress, blockNumber: 1n });
    expect(r.best).not.toBeNull();
    expect(r.venueErrors.length).toBeGreaterThan(0);
    expect(r.venueErrors[0]!.error).toBe("no_quote");
  });

  it("returns best=null when nothing can quote", async () => {
    const r = await plan({ client, adapters: [fakeVenue("uniswap_v3", {})], tokenIn: wBRL.address, tokenOut: wARS.address, amountIn, taker: zeroAddress, blockNumber: 1n });
    expect(r.best).toBeNull();
    expect(r.alternatives).toEqual([]);
  });

  it("applies slippage to every leg and the final minOut", async () => {
    const uni = fakeVenue("uniswap_v3", { [k(wBRL.address, USDT.address)]: 0.2, [k(USDT.address, wARS.address)]: 1600 });
    const r = await plan({ client, adapters: [uni], tokenIn: wBRL.address, tokenOut: wARS.address, amountIn, taker: zeroAddress, blockNumber: 1n, slippageBps: 100 });
    expect(r.best!.minOut).toBe(applySlippage(r.best!.expectedOut, 100));
    expect(r.best!.minOut * 10_000n).toBe(r.best!.expectedOut * 9_900n);
  });
});

describe("execution building", () => {
  it("builds approve + one atomic exactInput for an all-Uniswap two-hop", async () => {
    const uni = fakeVenue("uniswap_v3", { [k(wBRL.address, USDT.address)]: 0.2, [k(USDT.address, wARS.address)]: 1600 });
    const r = await plan({ client, adapters: [uni], tokenIn: wBRL.address, tokenOut: wARS.address, amountIn: toAtomic(wBRL.address, "200"), taker: zeroAddress, blockNumber: 1n });
    const recipient = "0x000000000000000000000000000000000000bEEF";
    const calls = buildRouteCalls(r.best!, recipient);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.to).toBe(wBRL.address);
    expect(calls[1]!.to).toBe(CONTRACTS.uniswap.swapRouter02);
    const decoded = decodeFunctionData({ abi: swapRouter02Abi, data: calls[1]!.data });
    expect(decoded.functionName).toBe("exactInput");
    const params = decoded.args[0] as { path: `0x${string}`; recipient: string; amountIn: bigint; amountOutMinimum: bigint };
    expect(params.path).toBe(encodePath(r.best!.legs));
    expect(params.path.toLowerCase()).toBe(
      `0x${wBRL.address.slice(2)}000064${USDT.address.slice(2)}000064${wARS.address.slice(2)}`.toLowerCase(),
    );
    expect(params.recipient).toBe(recipient);
    expect(params.amountOutMinimum).toBe(r.best!.minOut);
  });

  it("refuses routes with Textile legs until the spike lands", async () => {
    const tex = fakeVenue("textile_rfq", { [k(USDT.address, wARS.address)]: 1610 });
    const r = await plan({ client, adapters: [tex], tokenIn: USDT.address, tokenOut: wARS.address, amountIn: 1_000_000n, taker: zeroAddress, blockNumber: 1n });
    expect(() => buildRouteCalls(r.best!, zeroAddress)).toThrow(/Textile/);
  });
});

describe("math helpers", () => {
  it("derives a v3 mid price from sqrtPriceX96 with decimal adjustment", () => {
    // price1per0 = 1 with equal decimals ⇒ sqrtPriceX96 = 2^96
    expect(priceFromSqrtX96(1n << 96n, 18, 18)).toBeCloseTo(1, 12);
    // 18-dec token0, 6-dec token1 at raw ratio 1e-12 ⇒ 1.0 after adjustment
    const sqrt = BigInt(Math.round(Math.sqrt(1e-12) * 2 ** 48)) << 48n;
    expect(priceFromSqrtX96(sqrt, 18, 6)).toBeCloseTo(1, 6);
  });
  it("formats atomic amounts only at the edge", () => {
    expect(fmtAmount(wARS.address, toAtomic(wARS.address, "63729.20641"))).toBe("63,729.2064 wARS");
    expect(fmtAmount(USDT.address, 39_728_611n)).toBe("39.7286 USDT");
  });
});
