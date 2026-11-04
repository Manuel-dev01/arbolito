import { describe, expect, it } from "vitest";
import { MIN_PRICING_MICROS, pricesFrom, spendableBalance } from "../src/lib/miniapp/client/derive";

const ACCOUNT = "0x7769a27123aac03693065cd61a003c9dbb8ba734";

it("leaves dollar gas for All, including wallets holding less than the buffer", () => {
  const balances = { balances: [{ sym: "USDT", amount: "97420862" }, { sym: "wARS", amount: "1000000000000000000" }] } as never;
  expect(spendableBalance(balances, "USDT")).toBe(97_370_862n);
  expect(spendableBalance(balances, "wARS")).toBe(10n ** 18n);
  expect(spendableBalance({ balances: [{ sym: "USDT", amount: "49999" }] } as never, "USDT")).toBe(0n);
});
const rates = {
  at: "2026-10-28T14:00:00Z",
  references: [
    { name: "crypto", pair: "USD/ARS", rate: "1650", source: "x", at: "2026-10-28T14:00:00Z" },
    { name: "official", pair: "BRL/ARS", rate: "288.336", source: "x", at: "2026-10-28T14:00:00Z" },
  ],
} as never;
const dollarsPer = (micros: bigint | undefined) => (micros ? 1e6 / Number(micros) : null);

describe("pricesFrom", () => {
  it("doesn't price a currency from dust (2026-10-28: 0.0001 wBRL worth 1 micro showed R$ 112 per dollar)", () => {
    const p = pricesFrom(
      {
        account: ACCOUNT,
        balances: [
          { sym: "USDT", amount: "23000000", decimals: 6 },
          { sym: "wBRL", amount: "112000000000000", decimals: 18 }, // 0.000112 wBRL
        ],
        usdMicros: { USDT: "23000000", wBRL: "1" },
        blockNumber: "1",
      } as never,
      rates,
    );
    // Priced from the references instead: 1650 ARS per US$ ÷ 288.336 ARS per R$ ≈ R$ 5.72 per US$.
    expect(dollarsPer(p.BRL)).toBeGreaterThan(5);
    expect(dollarsPer(p.BRL)).toBeLessThan(6);
  });

  it("still prices from a real holding (at least a cent)", () => {
    const p = pricesFrom(
      {
        account: ACCOUNT,
        balances: [{ sym: "wBRL", amount: (53n * 10n ** 18n).toString(), decimals: 18 }],
        usdMicros: { wBRL: "9970000" }, // 53 wBRL ≈ US$ 9.97
        blockNumber: "1",
      } as never,
      rates,
    );
    expect(dollarsPer(p.BRL)).toBeCloseTo(53 / 9.97, 2);
    expect(MIN_PRICING_MICROS).toBe(10_000n);
  });

  it("prices COP and MXN from a USD/X reference when the user holds none", () => {
    const p = pricesFrom({ account: ACCOUNT, balances: [], usdMicros: {}, blockNumber: "1" } as never, {
      at: "2026-11-01T12:00:00Z",
      references: [
        { name: "interbank", pair: "USD/COP", rate: "3190", source: "x", at: "2026-11-01T12:00:00Z" },
        { name: "textile_mid", pair: "USD/MXN", rate: "18.77", source: "x", at: "2026-11-01T12:00:00Z" },
      ],
    } as never);
    expect(dollarsPer(p.COP)).toBeCloseTo(3190, -1);
    expect(dollarsPer(p.MXN)).toBeCloseTo(18.77, 0);
  });
});
