import { encodeFunctionData, encodePacked, type Address, type Hex, type PublicClient } from "viem";
import { CONTRACTS, POOLS, tokenByAddress, type PoolInfo } from "@arbolito/config";
import { erc20Abi, quoterV2Abi, swapRouter02Abi } from "../abis";
import type { Call, Leg, Quote, QuoteParams, VenueAdapter } from "../types";

function routablePool(tokenIn: Address, tokenOut: Address): PoolInfo | undefined {
  const a = tokenByAddress(tokenIn).symbol;
  const b = tokenByAddress(tokenOut).symbol;
  return POOLS.find(
    (p) => p.routable && ((p.token0 === a && p.token1 === b) || (p.token0 === b && p.token1 === a)),
  );
}

/** Uniswap v3 on Celo via QuoterV2 (exact input, single pool per leg). */
export class UniswapV3Adapter implements VenueAdapter {
  readonly venue = "uniswap_v3" as const;
  constructor(private readonly client: PublicClient) {}

  async quote(p: QuoteParams): Promise<Quote | null> {
    const pool = routablePool(p.tokenIn, p.tokenOut);
    if (!pool || p.amountIn <= 0n) return null;
    try {
      const [amountOut, sqrtPriceX96After, ticksCrossed, gasEstimate] = await this.client.readContract({
        address: CONTRACTS.uniswap.quoterV2,
        abi: quoterV2Abi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: p.tokenIn, tokenOut: p.tokenOut, amountIn: p.amountIn, fee: pool.fee, sqrtPriceLimitX96: 0n }],
        blockNumber: p.blockNumber,
      });
      if (amountOut === 0n) return null;
      return {
        venue: this.venue,
        tokenIn: p.tokenIn,
        tokenOut: p.tokenOut,
        amountIn: p.amountIn,
        amountOut,
        blockNumber: p.blockNumber,
        firm: false,
        raw: { quoter: CONTRACTS.uniswap.quoterV2, sqrtPriceX96After, initializedTicksCrossed: ticksCrossed, gasEstimate },
        meta: { pool: pool.address, fee: pool.fee },
      };
    } catch {
      // Insufficient liquidity or a pool revert: the venue simply can't quote.
      return null;
    }
  }
}

export const applySlippage = (amount: bigint, slippageBps: number) =>
  (amount * BigInt(10_000 - slippageBps)) / 10_000n;

/** Uniswap v3 path bytes: token, fee, token, fee, token… */
export function encodePath(legs: Leg[]): Hex {
  const types: ("address" | "uint24")[] = ["address"];
  const values: (Address | number)[] = [legs[0]!.quote.tokenIn];
  for (const leg of legs) {
    if (leg.quote.meta?.fee === undefined) throw new Error("Uniswap leg is missing its fee tier");
    types.push("uint24", "address");
    values.push(leg.quote.meta.fee, leg.quote.tokenOut);
  }
  return encodePacked(types, values);
}

/**
 * Calls for an all-Uniswap route: approve the router for exactly amountIn, then one
 * swap. Multi-hop routes use a single atomic exactInput, so only the final minOut matters.
 */
export function buildUniswapCalls(legs: Leg[], recipient: Address, minOut: bigint): Call[] {
  const first = legs[0]!;
  const router = CONTRACTS.uniswap.swapRouter02;
  const approve: Call = {
    to: first.quote.tokenIn,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [router, first.quote.amountIn] }),
    value: 0n,
    label: `approve ${tokenByAddress(first.quote.tokenIn).symbol} to SwapRouter02`,
  };
  const swap: Call =
    legs.length === 1
      ? {
          to: router,
          data: encodeFunctionData({
            abi: swapRouter02Abi,
            functionName: "exactInputSingle",
            args: [
              {
                tokenIn: first.quote.tokenIn,
                tokenOut: first.quote.tokenOut,
                fee: first.quote.meta!.fee!,
                recipient,
                amountIn: first.quote.amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0n,
              },
            ],
          }),
          value: 0n,
          label: "SwapRouter02.exactInputSingle",
        }
      : {
          to: router,
          data: encodeFunctionData({
            abi: swapRouter02Abi,
            functionName: "exactInput",
            args: [{ path: encodePath(legs), recipient, amountIn: first.quote.amountIn, amountOutMinimum: minOut }],
          }),
          value: 0n,
          label: `SwapRouter02.exactInput (${legs.length} hops)`,
        };
  return [approve, swap];
}
