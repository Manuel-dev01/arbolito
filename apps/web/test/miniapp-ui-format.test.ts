import { describe, expect, it } from "vitest";
import {
  atomicToTyped,
  fmtMoney,
  fmtNumber,
  fmtPct,
  fmtRateLine,
  fmtSym,
  fmtTyped,
  maskPhone,
  parseHuman,
  receiptRef,
  toApiAmount,
} from "../src/lib/miniapp/client/format";
import { DEFAULT_RULES, isPositive, pressKey, type Key } from "../src/lib/miniapp/client/keypad";
import { countdown } from "../src/lib/miniapp/client/countdown";
import { mapApiError } from "../src/lib/miniapp/client/errors";
import { fill, miniT, pickLang } from "../src/i18n/miniapp";

const E18 = 10n ** 18n;

describe("amount formatting per locale", () => {
  it("formats the design's numbers in es-AR", () => {
    expect(fmtSym(3177411900000000000000n, "wARS", "es")).toBe("ARS 3.177,41");
    expect(fmtSym(10n * E18, "wBRL", "es")).toBe("R$ 10,00");
    expect(fmtSym(860_000000n, "USDT", "es")).toBe("US$ 860,00");
    expect(fmtMoney(182450n * E18, 18, "ARS", "es")).toBe("ARS 182.450,00");
  });
  it("formats pt-BR and en", () => {
    expect(fmtSym(10n * E18, "wBRL", "pt")).toBe("R$ 10,00");
    expect(fmtSym(48200n * E18, "wBRL", "pt")).toBe("R$ 48.200,00");
    expect(fmtSym(1608_500000n, "USDT", "en")).toBe("US$ 1,608.50");
  });
  it("rounds half away from zero with exact bigints and supports dp 0 and signs", () => {
    expect(fmtNumber(3177415000000000000000n, 18, "es")).toBe("3.177,42");
    expect(fmtMoney(158n * E18 + E18 / 3n, 18, "ARS", "es", { dp: 0 })).toBe("ARS 158");
    expect(fmtMoney(3177n * E18, 18, "ARS", "es", { signed: true })).toBe("+ARS 3.177,00");
    expect(fmtMoney(-45000n * E18, 18, "ARS", "es")).toBe("−ARS 45.000,00");
    expect(fmtNumber(1234567n, 0, "en", 0)).toBe("1,234,567");
  });
  it("formats percentages and rate lines", () => {
    expect(fmtPct(5.24, "es")).toBe("+5,24%");
    expect(fmtPct(4.08, "en")).toBe("+4.08%");
    expect(fmtPct(-0.5, "pt")).toBe("−0,50%");
    expect(fmtRateLine("317.74119", "wBRL", "wARS", "es")).toBe("1 R$ = ARS 317,74");
    // Below 1 the line is inverted so it stays readable.
    expect(fmtRateLine("0.19761", "wBRL", "USDT", "es")).toBe("1 US$ = R$ 5,06");
  });
  it("shows typed amounts with the locale decimal key", () => {
    expect(fmtTyped("1240.5", "BRL", "es")).toBe("R$ 1.240,5");
    expect(fmtTyped("10.", "BRL", "pt")).toBe("R$ 10,");
    expect(fmtTyped("1240.5", "USD", "en")).toBe("US$ 1,240.5");
    expect(fmtTyped("0", "ARS", "es")).toBe("ARS 0");
  });
});

describe("amount parsing", () => {
  it("parses human amounts to atomic units", () => {
    expect(parseHuman("10", 18)).toBe(10n * E18);
    expect(parseHuman("10.5", 6)).toBe(10_500000n);
    expect(parseHuman(".5", 2)).toBe(50n);
    expect(parseHuman("1.23456789", 6)).toBe(1_234567n);
    expect(() => parseHuman("1,5", 6)).toThrow();
    expect(() => parseHuman("", 6)).toThrow();
  });
  it("converts keypad strings for the API and back", () => {
    expect(toApiAmount("10.")).toBe("10");
    expect(toApiAmount("010.50")).toBe("10.50");
    expect(toApiAmount("0")).toBeNull();
    expect(toApiAmount("0.00")).toBeNull();
    expect(atomicToTyped(1240n * E18, 18)).toBe("1240");
    expect(atomicToTyped(10_559999n, 6)).toBe("10.55");
    expect(atomicToTyped(10_500000n, 6)).toBe("10.5");
  });
});

describe("privacy helpers", () => {
  it("masks phone numbers keeping the prefix and the last 4 digits", () => {
    expect(maskPhone("+54 9 11 5832-4107")).toBe("+54 9 11 •••• 4107");
    expect(maskPhone("+55 21 99812-3307")).toMatch(/•••• 3307$/);
    expect(maskPhone("+55 21 99812-3307")).not.toContain("9812");
    expect(maskPhone("1234")).toBe("1234");
  });
  it("derives a short receipt reference", () => {
    expect(receiptRef("a7f329c1-5b2e-4d0a-9e1f-3c6b8d2a41c7")).toBe("#A7F3-29");
  });
});

describe("keypad input rules", () => {
  const type = (keys: Key[], start = "0") => keys.reduce((v, k) => pressKey(v, k), start);
  it("replaces the leading zero and appends digits", () => {
    expect(type(["1", "0"])).toBe("10");
    expect(type(["0", "0", "5"])).toBe("5");
  });
  it("allows one decimal key and at most 2 decimals", () => {
    expect(type(["1", ".", ".", "5"])).toBe("1.5");
    expect(type(["1", ".", "2", "3", "4"])).toBe("1.23");
    expect(type([".", "5"])).toBe("0.5");
  });
  it("caps total digits at 8", () => {
    expect(type(["1", "2", "3", "4", "5", "6", "7", "8", "9"])).toBe("12345678");
    expect(pressKey("123456.7", "8", DEFAULT_RULES)).toBe("123456.78");
    expect(pressKey("123456.78", "9", DEFAULT_RULES)).toBe("123456.78");
  });
  it("deletes back to 0", () => {
    expect(type(["del"], "12")).toBe("1");
    expect(type(["del", "del"], "12")).toBe("0");
    expect(type(["del"], "1.")).toBe("1");
  });
  it("knows when an amount is positive", () => {
    expect(isPositive("0")).toBe(false);
    expect(isPositive("0.")).toBe(false);
    expect(isPositive("0.05")).toBe(true);
    expect(isPositive("10")).toBe(true);
  });
});

describe("countdown phase", () => {
  const exp = 1_000_000;
  it("is normal above 10 s", () => {
    const c = countdown(exp, exp - 48_000, 48_000);
    expect(c).toEqual({ secs: 48, phase: "normal", fraction: 1 });
    expect(countdown(exp, exp - 11_000, 48_000).phase).toBe("normal");
  });
  it("turns low (pink) in the last 10 s", () => {
    expect(countdown(exp, exp - 10_000, 48_000).phase).toBe("low");
    const c = countdown(exp, exp - 500, 48_000);
    expect(c.secs).toBe(1);
    expect(c.phase).toBe("low");
  });
  it("expires at zero and after", () => {
    expect(countdown(exp, exp, 48_000)).toEqual({ secs: 0, phase: "expired", fraction: 0 });
    expect(countdown(exp, exp + 5_000, 48_000).secs).toBe(0);
  });
  it("sizes the bar against the quote's own window", () => {
    expect(countdown(exp, exp - 15_000, 30_000).fraction).toBeCloseTo(0.5);
  });
});

describe("ApiError codes → UI states", () => {
  it("maps each contract code", () => {
    expect(mapApiError("no_route")).toEqual({ kind: "no-market" });
    expect(mapApiError("quote_expired")).toEqual({ kind: "expired" });
    expect(mapApiError("price_changed")).toEqual({ kind: "price-changed" });
    expect(mapApiError("needs_taker_proof")).toEqual({ kind: "needs-proof" });
    expect(mapApiError("not_ready")).toEqual({ kind: "toast", message: "notReady", retry: false });
    expect(mapApiError("rate_limited")).toEqual({ kind: "toast", message: "rateLimited", retry: true });
    expect(mapApiError("upstream")).toEqual({ kind: "toast", message: "upstream", retry: true });
    expect(mapApiError("bad_request")).toEqual({ kind: "toast", message: "generic", retry: false });
  });
  it("maps client-side failures", () => {
    expect(mapApiError("network")).toEqual({ kind: "toast", message: "offline", retry: true });
    expect(mapApiError("bad_response")).toEqual({ kind: "toast", message: "generic", retry: false });
  });
});

describe("i18n", () => {
  it("has the same keys in every language", () => {
    const keys = (o: object) => Object.keys(o).sort();
    expect(keys(miniT("pt"))).toEqual(keys(miniT("es")));
    expect(keys(miniT("en"))).toEqual(keys(miniT("es")));
  });
  it("fills placeholders and picks a language", () => {
    expect(fill(miniT("es").doneT, { x: "ARS 3.177,41" })).toBe("Listo. Recibiste ARS 3.177,41");
    expect(pickLang("pt", "es-AR")).toBe("pt");
    expect(pickLang(null, "pt-BR")).toBe("pt");
    expect(pickLang(undefined, "fr-FR")).toBe("es");
  });
});
