/**
 * Desk fills from onchain token transfers. A fill is a transaction someone else sent (a taker
 * settling our firm quote) in which the desk wallet's soft asset and USDT move in opposite
 * directions. Funding, gas and the desk's own swaps are not fills. Pure.
 */
import type { Address, Hex } from "viem";
import { TOKENS } from "@arbolito/config";
import type { Corridor } from "./corridors";

export interface DeskTransfer {
  txHash: Hex;
  blockNumber: bigint;
  token: Address;
  from: Address;
  to: Address;
  value: bigint;
}

export interface Fill {
  txHash: Hex;
  blockNumber: bigint;
  pair: Corridor["pair"];
  /** From the desk's side. */
  side: "buy" | "sell";
  softAmount: bigint;
  usdtAmount: bigint;
  /** USDT per soft unit. */
  price: number;
}

const lc = (a: string) => a.toLowerCase();

/** Group the desk's transfers by tx and keep the ones that are fills. */
export function fillsFromTransfers(desk: Address, transfers: DeskTransfer[], corridors: readonly Corridor[], txFrom: (hash: Hex) => Address | undefined): Fill[] {
  const usdt = lc(TOKENS.USDT.address);
  const byTx = new Map<Hex, DeskTransfer[]>();
  for (const t of transfers) byTx.set(t.txHash, [...(byTx.get(t.txHash) ?? []), t]);
  const fills: Fill[] = [];
  for (const [hash, ts] of byTx) {
    const sender = txFrom(hash);
    if (!sender || lc(sender) === lc(desk)) continue; // our own txs (funding swaps, approvals) aren't fills
    const net = (token: string) =>
      ts.reduce((s, t) => (lc(t.token) !== token ? s : lc(t.to) === lc(desk) ? s + t.value : lc(t.from) === lc(desk) ? s - t.value : s), 0n);
    const dUsdt = net(usdt);
    for (const c of corridors) {
      const dSoft = net(lc(TOKENS[c.soft].address));
      if (dSoft === 0n || dUsdt === 0n || dSoft > 0n === dUsdt > 0n) continue;
      const softAmount = dSoft < 0n ? -dSoft : dSoft;
      const usdtAmount = dUsdt < 0n ? -dUsdt : dUsdt;
      const price = Number(usdtAmount) / 1e6 / (Number(softAmount) / 10 ** TOKENS[c.soft].decimals);
      fills.push({ txHash: hash, blockNumber: ts[0]!.blockNumber, pair: c.pair, side: dSoft > 0n ? "buy" : "sell", softAmount, usdtAmount, price });
      break; // one pair per settlement
    }
  }
  return fills.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
}

/** Price vs fair from the desk's side, bps: selling above fair or buying below it is positive. */
export function edgeBps(side: Fill["side"], price: number, fair: number): number {
  const e = side === "sell" ? price / fair - 1 : fair / price - 1;
  return Math.round(e * 1_000_000) / 100;
}

/**
 * USDT + every corridor's soft asset valued at fair (USDT per soft, by pair), micro-USD.
 * Undefined when a held asset has no fair price.
 */
export function navMicros(b: Partial<Record<Corridor["soft"], bigint>> & { USDT: bigint }, corridors: readonly Corridor[], fair: Record<string, number | undefined>): bigint | undefined {
  let soft = 0;
  for (const c of corridors) {
    const amt = b[c.soft] ?? 0n;
    if (amt === 0n) continue;
    const px = fair[c.pair];
    if (px === undefined) return undefined;
    soft += (Number(amt) / 10 ** TOKENS[c.soft].decimals) * px;
  }
  return b.USDT + BigInt(Math.round(soft * 1e6));
}
