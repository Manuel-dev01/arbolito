import { describe, expect, it } from "vitest";
import {
  applyRate,
  fiatOfSymbol,
  formatBps,
  formatFixed,
  formatMoney,
  formatRate,
  formatToken,
  medianBigint,
  parseDecimal,
  rateOf,
  RATE_ONE,
  roundToDp,
  shortHex,
} from "../src/lib/format";

const NBSP = " ";
const wARS = 18;
const USDT = 6;

describe("parseDecimal", () => {
  it("scales decimal strings exactly", () => {
    expect(parseDecimal("1542.7")).toBe(1542_700000000000000000n);
    expect(parseDecimal("5.0593844", 8)).toBe(505938440n);
    expect(parseDecimal("301.9033", 4)).toBe(3019033n);
    expect(parseDecimal("7")).toBe(7n * RATE_ONE);
    expect(parseDecimal(".5", 2)).toBe(50n);
  });
  it("truncates digits beyond the scale and rejects junk", () => {
    expect(parseDecimal("1.23456", 2)).toBe(123n);
    expect(() => parseDecimal("abc")).toThrow();
    expect(() => parseDecimal("")).toThrow();
  });
});

describe("roundToDp", () => {
  it("rounds half away from zero", () => {
    expect(roundToDp(3_177_411908400035561279n, wARS, 2)).toBe(317741n);
    expect(roundToDp(1_005n, 3, 2)).toBe(101n);
    expect(roundToDp(1_004n, 3, 2)).toBe(100n);
    expect(roundToDp(-1_005n, 3, 2)).toBe(-101n);
    expect(roundToDp(25n, 1, 3)).toBe(2500n);
  });
});

describe("formatFixed", () => {
  it("groups and uses the locale's decimal separator", () => {
    const v = 3_177_411908400035561279n;
    expect(formatFixed(v, wARS, "es-AR", { dp: 2 })).toBe("3.177,41");
    expect(formatFixed(v, wARS, "pt-BR", { dp: 2 })).toBe("3.177,41");
    expect(formatFixed(v, wARS, "en-US", { dp: 2 })).toBe("3,177.41");
  });
  it("trims trailing zeros down to minDp and signs", () => {
    expect(formatFixed(2_500000n, USDT, "en-US", { dp: 4, minDp: 0 })).toBe("2.5");
    expect(formatFixed(10n * 10n ** 18n, 18, "en-US", { dp: 4, minDp: 0 })).toBe("10");
    expect(formatFixed(158_378908400035561279n, 18, "en-US", { dp: 2, signed: true })).toBe("+158.38");
    expect(formatFixed(-5n, 2, "en-US", { dp: 2, signed: true })).toBe("-0.05");
    expect(formatFixed(0n, 2, "en-US", { dp: 2, signed: true })).toBe("0.00");
  });
  it("handles amounts beyond Number precision", () => {
    expect(formatFixed(123456789012345678901234567890n, 18, "en-US", { dp: 2 })).toBe("123,456,789,012.35");
  });
});

describe("formatMoney", () => {
  it("shows the user's currency, dropping .00 on whole amounts", () => {
    expect(formatMoney(10n * 10n ** 18n, 18, "BRL", "es-AR")).toBe(`R$${NBSP}10`);
    expect(formatMoney(3_177_411908400035561279n, 18, "ARS", "es-AR")).toBe(`ARS${NBSP}3.177,41`);
    expect(formatMoney(3_177_411908400035561279n, 18, "ARS", "en-US")).toBe(`ARS${NBSP}3,177.41`);
    expect(formatMoney(2_500000n, 6, "USD", "pt-BR")).toBe(`US$${NBSP}2,50`);
  });
  it("puts the sign before the currency", () => {
    expect(formatMoney(158_378908400035561279n, 18, "ARS", "es-AR", { signed: true })).toBe(`+ARS${NBSP}158,38`);
    expect(formatMoney(-15_087963151112771454n, 18, "ARS", "en-US", { signed: true })).toBe(`-ARS${NBSP}15.09`);
  });
});

describe("formatToken", () => {
  it("shows up to 4 decimals with the symbol", () => {
    expect(formatToken(3_177_411908400035561279n, 18, "wARS", "es-AR")).toBe(`3.177,4119${NBSP}wARS`);
    expect(formatToken(2_500000n, 6, "USDT", "en-US")).toBe(`2.5${NBSP}USDT`);
  });
});

describe("rates", () => {
  it("computes tokenOut per tokenIn across decimals", () => {
    // 10 wBRL → 3,177.41 wARS: 317.74 ARS per BRL
    const r = rateOf(10n * 10n ** 18n, 18, 3_177_411908400035561279n, 18);
    expect(formatRate(r, "es-AR")).toBe("317,74");
    // 2.5 USDT → 12.647 wBRL: 5.0588 BRL per USD (6 → 18 decimals)
    const u = rateOf(2_500000n, 6, 12_647118280431389240n, 18);
    expect(formatRate(u, "en-US")).toBe("5.0588");
    expect(rateOf(0n, 6, 1n, 18)).toBe(0n);
  });
  it("applies a rate between decimals", () => {
    expect(applyRate(10n * 10n ** 18n, 18, parseDecimal("301.9033"), 18)).toBe(3019_033000000000000000n);
    expect(applyRate(2_500000n, 6, parseDecimal("5.0593844"), 18)).toBe(12_648461000000000000n);
  });
  it("picks precision by magnitude", () => {
    expect(formatRate(parseDecimal("0.000621"), "en-US")).toBe("0.000621");
  });
});

describe("misc", () => {
  it("maps token symbols to fiat", () => {
    expect(fiatOfSymbol("wARS")).toBe("ARS");
    expect(fiatOfSymbol("USDT")).toBe("USD");
    expect(fiatOfSymbol("USAT")).toBe("USD");
    expect(fiatOfSymbol("BRLm")).toBe("BRL");
    expect(fiatOfSymbol("CELO")).toBe("CELO");
  });
  it("formats basis points per locale", () => {
    expect(formatBps(524, "es-AR")).toBe(`+5,24${NBSP}%`);
    expect(formatBps(-7, "en-US")).toBe("-0.07%");
  });
  it("shortens hex and takes medians", () => {
    expect(shortHex("0x43ab6ccad6b56d72e76cdfba312b7f42923016da8d361eb26aba9da23f5ee743")).toBe("0x43ab6cca…e743");
    expect(medianBigint([])).toBeUndefined();
    expect(medianBigint([5n, 1n, 3n])).toBe(3n);
    expect(medianBigint([524n, 100n])).toBe(312n);
  });
});
