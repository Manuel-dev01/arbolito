import type { Address, PublicClient } from "viem";
import { TOKENS, tokenByAddress } from "@arbolito/config";
import { UniswapV3Adapter } from "./uniswap/adapter";

/**
 * USD value of a token amount in micro-USD (6 decimals), for cap enforcement.
 * USD stables count 1:1. wARS/wBRL are valued by a QuoterV2 quote into USDT.
 * Throws if a token can't be priced; an unpriceable action must not pass the caps.
 */
export async function usdMicros(client: PublicClient, token: Address, amount: bigint, blockNumber?: bigint): Promise<bigint> {
  const t = tokenByAddress(token);
  if (t.kind === "usd") return t.decimals === 6 ? amount : amount / 10n ** BigInt(t.decimals - 6);
  if (t.symbol === "USDm") return amount / 10n ** 12n;
  const block = blockNumber ?? (await client.getBlockNumber());
  const q = await new UniswapV3Adapter(client).quote({
    tokenIn: token,
    tokenOut: TOKENS.USDT.address,
    amountIn: amount,
    taker: token,
    blockNumber: block,
  });
  if (!q) throw new Error(`Cannot price ${t.symbol} in USD`);
  return q.amountOut;
}
