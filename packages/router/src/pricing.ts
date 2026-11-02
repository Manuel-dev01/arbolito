import type { Address, PublicClient } from "viem";
import { CELO_MAINNET_ID, TOKENS, tokenByAddress } from "@arbolito/config";
import { TextileClient } from "./textile/api";
import { UniswapV3Adapter } from "./uniswap/adapter";

/**
 * USD value of a token amount in micro-USD (6 decimals), for cap enforcement.
 * USD stables count 1:1. wARS/wBRL are valued by a QuoterV2 quote into USDT; a wFIAT with no
 * Uniswap pool (wCOP, wMXN) by Textile's free preview into USDT (reserves nothing).
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
  if (q) return q.amountOut;
  if (t.kind === "wfiat") {
    // 3 s: a cold Textile corridor took 2.9 s to answer its first preview (2026-11-01).
    const p = await new TextileClient().preview({ chainId: CELO_MAINNET_ID, sellToken: token, buyToken: TOKENS.USDT.address, sellAmount: amount }, 3_000);
    // Only a full-size price counts: a thin book priced for less would undervalue the amount.
    if (p.status === "preview" && p.buyAmount && p.buyAmount !== "0" && (!p.sellAmount || BigInt(p.sellAmount) >= amount)) return BigInt(p.buyAmount);
  }
  throw new Error(`Cannot price ${t.symbol} in USD`);
}
