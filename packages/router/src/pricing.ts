import type { Address, PublicClient } from "viem";
import { CELO_MAINNET_ID, TOKENS, tokenByAddress } from "@arbolito/config";
import { TextileClient } from "./textile/api";
import { UniswapV3Adapter } from "./uniswap/adapter";

/**
 * USD value of a token amount in micro-USD (6 decimals), for cap enforcement.
 * USD stables count 1:1. A wFIAT is valued at the better of a QuoterV2 quote into USDT and
 * Textile's free preview (reserves nothing), the way the router would sell it: a thin or drained
 * Uniswap pool must not value a balance at a fraction of what it's worth (the wBRL/USDT pool held
 * 147K wBRL and 23 USDT on 2026-11-03, quoting R$ 10.91 at US$ 0.03). Taking the higher value is
 * also the conservative side for caps.
 * Throws if a token can't be priced; an unpriceable action must not pass the caps.
 */
export async function usdMicros(client: PublicClient, token: Address, amount: bigint, blockNumber?: bigint): Promise<bigint> {
  const t = tokenByAddress(token);
  if (t.kind === "usd") return t.decimals === 6 ? amount : amount / 10n ** BigInt(t.decimals - 6);
  if (t.symbol === "USDm") return amount / 10n ** 12n;
  const block = blockNumber ?? (await client.getBlockNumber());
  const uniswap = new UniswapV3Adapter(client)
    .quote({ tokenIn: token, tokenOut: TOKENS.USDT.address, amountIn: amount, taker: token, blockNumber: block })
    .then((q) => q?.amountOut ?? null);
  const textile =
    t.kind === "wfiat"
      ? // 3 s: a cold Textile corridor took 2.9 s to answer its first preview (2026-11-01).
        new TextileClient()
          .preview({ chainId: CELO_MAINNET_ID, sellToken: token, buyToken: TOKENS.USDT.address, sellAmount: amount }, 3_000)
          // Only a full-size price counts: a thin book priced for less would undervalue the amount.
          .then((p) => (p.status === "preview" && p.buyAmount && p.buyAmount !== "0" && (!p.sellAmount || BigInt(p.sellAmount) >= amount) ? BigInt(p.buyAmount) : null))
          .catch(() => null)
      : Promise.resolve(null);
  const [u, x] = await Promise.all([uniswap, textile]);
  const best = u !== null && x !== null ? (u > x ? u : x) : (u ?? x);
  if (best !== null) return best;
  throw new Error(`Cannot price ${t.symbol} in USD`);
}
