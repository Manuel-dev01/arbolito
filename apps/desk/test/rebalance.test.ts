import { describe, expect, it } from "vitest";
import { CORRIDORS, REBALANCE, RESUME_RATIO, nextSlice, type Balances } from "../src";

const zero: Balances = { USDT: 0n, wARS: 0n, wBRL: 0n, USDC: 0n, USAT: 0n, wCOP: 0n, wMXN: 0n };
const fair = { "wars-usdt": 1 / 1600, "wbrl-usdt": 0.2, "usdc-usdt": 1, "usat-usdt": 1, "wcop-usdt": 1 / 3170, "wmxn-usdt": 1 / 18.5 };
const brl = CORRIDORS.find((c) => c.pair === "wbrl-usdt")!;
const wbrl = (usd: number) => ({ ...zero, wBRL: BigInt(Math.round(usd / 0.2)) * 10n ** 18n });
const OFF = new Set(["wbrl-usdt"]);
const NOW = 1_000_000_000;

describe("rebalancer slices", () => {
  it("sells at most US$ 5 of an over-cap corridor whose buy side is off, with a floor under fair", () => {
    const s = nextSlice(wbrl(40), CORRIDORS, fair, OFF, new Map(), NOW)!;
    expect(s.pair).toBe("wbrl-usdt");
    expect(s.amount).toBe(25n * 10n ** 18n); // US$ 5 at 0.2 USDT per wBRL
    expect(s.usd).toBeCloseTo(5);
    expect(s.maxUnderFairBps).toBe(REBALANCE.maxUnderFairBps.wfiat);
    expect(s.minUsdtOut).toBe(4_980_000n); // 5 USDT − 40 bps
  });

  it("does nothing while the buy side is on, below the resume level, or in the cooldown", () => {
    expect(nextSlice(wbrl(40), CORRIDORS, fair, new Set(), new Map(), NOW)).toBeNull();
    expect(nextSlice(wbrl(brl.maxSoftUsd * RESUME_RATIO - 0.5), CORRIDORS, fair, OFF, new Map(), NOW)).toBeNull();
    expect(nextSlice(wbrl(40), CORRIDORS, fair, OFF, new Map([["wbrl-usdt", NOW - 60_000]]), NOW)).toBeNull();
    expect(nextSlice(wbrl(40), CORRIDORS, fair, OFF, new Map([["wbrl-usdt", NOW - REBALANCE.cooldownMs]]), NOW)).not.toBeNull();
  });

  it("sells only down to the target, and never below the RFQ sell size", () => {
    // Just over the resume level: the slice is the excess over the target, not a full US$ 5.
    const v = brl.maxSoftUsd * RESUME_RATIO + 0.5;
    const s = nextSlice(wbrl(v), CORRIDORS, fair, OFF, new Map(), NOW)!;
    expect(Math.abs(s.usd - (v - brl.maxSoftUsd * REBALANCE.targetRatio))).toBeLessThan(0.25); // wbrl() rounds to whole wBRL
    expect(s.usd).toBeLessThan(REBALANCE.maxSliceUsd);
    // Holdings barely above the sell size: what's left to sell is under US$ 1, so nothing.
    const tight = { ...zero, wBRL: brl.sellCapSoft + 2n * 10n ** 18n };
    expect(nextSlice(tight, [{ ...brl, maxSoftUsd: 5 }], fair, OFF, new Map(), NOW)).toBeNull();
  });

  it("uses a tight floor for stablecoins and skips a corridor without a fair price", () => {
    const usdc = CORRIDORS.find((c) => c.pair === "usdc-usdt")!;
    const b = { ...zero, USDC: 30_000_000n };
    const s = nextSlice(b, CORRIDORS, fair, new Set(["usdc-usdt"]), new Map(), NOW)!;
    expect(s.amount).toBe(5_000_000n);
    expect(s.minUsdtOut).toBe(4_995_000n); // 10 bps
    const { "usdc-usdt": _, ...noUsdc } = fair;
    expect(nextSlice(b, [usdc], noUsdc, new Set(["usdc-usdt"]), new Map(), NOW)).toBeNull();
  });
});
