import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { TOKENS } from "@arbolito/config";
import { CORRIDORS, edgeBps, fillsFromTransfers, navMicros, type DeskTransfer } from "../src";

const DESK = "0xBCB8B7dcEB8B39457Ef6D5dC95520A562b13EdbE" as Address;
const SETTLE = "0x96E45f26088C66d18Fc940c8Fb1CF760A2e012dE" as Address;
const TAKER = "0x5dc26f4b815a03fdccd49bcc85b844e87cb9b77f" as Address;
const FOUNDER = "0x1111111111111111111111111111111111111111" as Address;
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const t = (tx: number, token: keyof typeof TOKENS, from: Address, to: Address, value: bigint): DeskTransfer => ({ txHash: h(tx), blockNumber: 100n + BigInt(tx), token: TOKENS[token].address as Address, from, to, value });
const senders: Record<string, Address> = { [h(1)]: TAKER, [h(2)]: TAKER, [h(3)]: DESK, [h(4)]: FOUNDER };

describe("fills from transfers", () => {
  const transfers = [
    // 1: the real first fill: desk sold 49.995 wBRL for 9.867652 USDT
    t(1, "wBRL", DESK, SETTLE, 49_995_001_590_163_619_884n),
    t(1, "USDT", SETTLE, DESK, 9_867_652n),
    // 2: desk bought 8,000 wARS for 5 USDT
    t(2, "USDT", DESK, SETTLE, 5_000_000n),
    t(2, "wARS", SETTLE, DESK, 8_000n * 10n ** 18n),
    // 3: the desk's own Uniswap funding swap (tx.from = desk): not a fill
    t(3, "USDT", DESK, SETTLE, 5_000_000n),
    t(3, "wARS", SETTLE, DESK, 8_057n * 10n ** 18n),
    // 4: the founder's USDT deposit: not a fill
    t(4, "USDT", FOUNDER, DESK, 40_000_000n),
  ];
  const fills = fillsFromTransfers(DESK, transfers, CORRIDORS, (x) => senders[x]);

  it("finds the taker settlements and only those", () => {
    expect(fills.map((f) => f.txHash)).toEqual([h(1), h(2)]);
  });

  it("reads side, sizes and price from the desk's side", () => {
    const [sell, buy] = fills;
    expect(sell).toMatchObject({ pair: "wbrl-usdt", side: "sell", usdtAmount: 9_867_652n });
    expect(sell!.price).toBeCloseTo(0.197373, 6);
    expect(buy).toMatchObject({ pair: "wars-usdt", side: "buy", softAmount: 8_000n * 10n ** 18n });
    expect(buy!.price).toBeCloseTo(0.000625, 9);
  });
});

describe("edge and NAV", () => {
  it("counts selling above fair and buying below it as positive edge", () => {
    expect(edgeBps("sell", 1.0006, 1)).toBeCloseTo(6, 6);
    expect(edgeBps("buy", 0.9994, 1)).toBeCloseTo(6.0, 1);
    expect(edgeBps("sell", 0.999, 1)).toBeLessThan(0);
  });

  it("values soft inventory at fair, in micro-USD", () => {
    expect(navMicros({ USDT: 20_000_000n, wARS: 16_000n * 10n ** 18n, wBRL: 50n * 10n ** 18n }, { wars: 1 / 1600, wbrl: 0.2 })).toBe(40_000_000n);
    expect(navMicros({ USDT: 1n, wARS: 1n, wBRL: 0n }, { wbrl: 0.2 })).toBeUndefined(); // wARS held, no fair
    expect(navMicros({ USDT: 5n, wARS: 0n, wBRL: 0n }, {})).toBe(5n);
  });
});
