/**
 * The desk wallet's inventory, per corridor. Reads balances (public calls, no key); the share
 * math is pure. USDT is shared by both corridors, so each corridor counts the part of it
 * proportional to its buy cap (the same split Stitch's fixed caps enforce).
 */
import { erc20Abi, formatUnits, type Address, type PublicClient } from "viem";
import { TOKENS } from "@arbolito/config";
import type { Corridor } from "./corridors";
import { inventoryShare } from "./skew";

export type Balances = Record<"USDT" | "wARS" | "wBRL" | "USDC" | "USAT", bigint>;

export async function readBalances(client: PublicClient, owner: Address): Promise<Balances> {
  const syms = ["USDT", "wARS", "wBRL", "USDC", "USAT"] as const;
  const res = await client.multicall({
    allowFailure: false,
    contracts: syms.map((s) => ({ address: TOKENS[s].address as Address, abi: erc20Abi, functionName: "balanceOf", args: [owner] }) as const),
  });
  return { USDT: res[0]!, wARS: res[1]!, wBRL: res[2]!, USDC: res[3]!, USAT: res[4]! };
}

/** Soft-asset share for each corridor, valuing the soft side at the corridor's fair value. */
export function corridorShares(b: Balances, corridors: readonly Corridor[], fiatPerUsd: Map<string, number>): Map<string, number | undefined> {
  const totalCaps = corridors.reduce((s, c) => s + c.buyCapUsdt, 0n);
  const out = new Map<string, number | undefined>();
  for (const c of corridors) {
    const f = fiatPerUsd.get(c.pair);
    if (!f || totalCaps === 0n) {
      out.set(c.pair, undefined);
      continue;
    }
    const usdt = (b.USDT * c.buyCapUsdt) / totalCaps;
    const usdtUsd = Number(formatUnits(usdt, TOKENS.USDT.decimals));
    const softUsd = Number(formatUnits(b[c.soft], TOKENS[c.soft].decimals)) / f;
    out.set(c.pair, inventoryShare(softUsd, usdtUsd));
  }
  return out;
}
