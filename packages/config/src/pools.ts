import type { Address } from "viem";
import { TOKENS, type TokenSymbol } from "./tokens";

/** Uniswap v3 pools on Celo. token0/token1 are the onchain order (verified by `pnpm verify:addresses`). */
export interface PoolInfo {
  name: string;
  address: Address;
  token0: TokenSymbol;
  token1: TokenSymbol;
  /** Fee in hundredths of a bip (100 = 0.01%). */
  fee: number;
  /** Used for routing. Dust pools stay in config for verification only. */
  routable: boolean;
  /** Pinned in the ArbolitoGuard contracts (their constructor args). Adding a routing pool never changes the guard. */
  guard: boolean;
}

export const POOLS = [
  { name: "wARS/USDT 0.01%", address: "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391", token0: "wARS", token1: "USDT", fee: 100, routable: true, guard: true },
  { name: "wBRL/USDT 0.01%", address: "0x01c3cf91cdf7B34181C7eC8566c0236951FEA40F", token0: "USDT", token1: "wBRL", fee: 100, routable: true, guard: true },
  { name: "USAT/USDT 0.01%", address: "0x070D575a713EaF5025462D0865Fb0Dac4B14bC38", token0: "USDT", token1: "USAT", fee: 100, routable: true, guard: true },
  /** Found 2026-10-17 via factory.getPool (fee 100): ~23.1K USDC + 164.7K USDT, so USDC trades at a small premium. */
  { name: "USDC/USDT 0.01%", address: "0x1a810e0B6c2dd5629AFa2f0c898b9512C6F78846", token0: "USDT", token1: "USDC", fee: 100, routable: true, guard: false },
  { name: "USAT/USDT 0.05%", address: "0xaE073a816117DcD1cC237fe4CB99F89F8F8bfF4F", token0: "USDT", token1: "USAT", fee: 500, routable: false, guard: false },
] as const satisfies readonly PoolInfo[];

/** Routable pools connecting two tokens, in either direction. */
export function poolsFor(a: TokenSymbol, b: TokenSymbol): PoolInfo[] {
  return POOLS.filter(
    (p) => p.routable && ((p.token0 === a && p.token1 === b) || (p.token0 === b && p.token1 === a)),
  );
}

export function tokenAddress(sym: TokenSymbol): Address {
  return TOKENS[sym].address;
}
