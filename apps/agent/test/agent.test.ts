import { describe, expect, it } from "vitest";
import { parseQuoteArgs } from "../src/bot";
import { copy, esc, langFromTelegram, t } from "../src/i18n";
import { formatAtomic, formatPct, formatRate, maskWallet, money } from "../src/money";
import { rampLink } from "../src/ripio";

describe("ripio deep links", () => {
  const addr = "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c";
  it("builds the on-ramp link with country, chain, token and address", () => {
    const u = new URL(rampLink({ direction: "on", token: "wARS", address: addr, amount: "10000" }));
    expect(u.origin + u.pathname).toBe("https://ramp.ripio.com/");
    expect(Object.fromEntries(u.searchParams)).toEqual({ country: "AR", chain: "42220", token: "WARS", address: addr, amount: "10000" });
  });
  it("uses /offramp and Brazil for wBRL", () => {
    const u = new URL(rampLink({ direction: "off", token: "wBRL", address: addr }));
    expect(u.pathname).toBe("/offramp");
    expect(u.searchParams.get("country")).toBe("BR");
    expect(u.searchParams.get("amount")).toBeNull();
  });
  it("rejects bad addresses, amounts and tokens", () => {
    expect(() => rampLink({ direction: "on", token: "wARS", address: "0x123" })).toThrow();
    expect(() => rampLink({ direction: "on", token: "wARS", address: addr, amount: "-5" })).toThrow();
    expect(() => rampLink({ direction: "on", token: "DOGE", address: addr })).toThrow();
  });
});

describe("money formatting", () => {
  it("formats atomic amounts per locale, rounding down", () => {
    expect(money("wARS", 160_800n * 10n ** 18n, "es")).toBe("ARS 160.800,00");
    expect(money("wARS", 160_800n * 10n ** 18n, "en")).toBe("ARS 160,800.00");
    expect(money("USDT", 100_000_000n, "pt")).toBe("US$ 100,00");
    expect(money("wBRL", "199999999999999999999", "es")).toBe("R$ 199,99");
    expect(money("USDC", 1n, "en")).toBe("US$ 0.00");
    expect(formatAtomic(-6_300n * 10n ** 18n, 18, 0, "es")).toBe("-6.300");
  });
  it("formats rates, percentages and wallets", () => {
    expect(formatRate("1608.4", "es")).toBe("1.608");
    expect(formatRate("317.7412", "es")).toBe("317,74");
    expect(formatRate("0.000621", "en")).toBe("0.000621");
    expect(formatRate("garbage", "en")).toBe("0");
    expect(formatPct(4.08, "es")).toBe("+4,08%");
    expect(formatPct(-0.44, "en")).toBe("-0.44%");
    expect(maskWallet("0x7e0316b2533F6dF2E651295A9B11481BB8346c3c")).toBe("0x7e03…6c3c");
    expect(maskWallet("<b>")).toBe("…");
  });
});

describe("/quote arguments", () => {
  it("accepts symbols in any case and a decimal amount", () => {
    expect(parseQuoteArgs("wBRL wARS 200")).toEqual({ from: "wBRL", to: "wARS", amount: "200" });
    expect(parseQuoteArgs("  usdt   wars  10,5 ")).toEqual({ from: "USDT", to: "wARS", amount: "10.5" });
  });
  it("rejects unknown tokens, same-token pairs, zero, junk and extra words", () => {
    for (const bad of ["", "wBRL wARS", "DOGE wARS 1", "wARS wARS 1", "wBRL wARS 0", "wBRL wARS -5", "wBRL wARS 1e9", "wBRL wARS 2 now"]) expect(parseQuoteArgs(bad)).toBeNull();
  });
});

describe("i18n", () => {
  it("maps Telegram language codes, defaulting to Spanish", () => {
    expect(langFromTelegram("pt-br")).toBe("pt");
    expect(langFromTelegram("en")).toBe("en");
    expect(langFromTelegram(undefined)).toBe("es");
    expect(langFromTelegram("fr")).toBe("es");
  });
  it("says no money moved, in bold, in every error line", () => {
    for (const lang of ["es", "pt", "en"] as const)
      for (const key of ["error", "rateLimited", "quoteBad"] as const) expect(t(key, lang)).toMatch(/<b>(No se movió plata|Nenhum dinheiro foi movido|No money moved)\.<\/b>/);
  });
  it("echoes voice transcripts in italics, escaped, in the spoken language", () => {
    expect(copy.voiceEcho("es", esc("pasá <100> dólares"))).toBe("🎙️ Entendí: <i>pasá &lt;100&gt; dólares</i>");
    expect(copy.voiceEcho("pt", "manda 200 reais")).toBe("🎙️ Entendi: <i>manda 200 reais</i>");
    expect(copy.voiceEcho("en", "hi")).toBe("🎙️ I heard: <i>hi</i>");
  });
  it("has no wallet-not-ready path any more", () => {
    expect(() => t("walletNotReady" as never, "es")).toThrow();
  });
});

describe("beta allowlist", () => {
  it("is open when unset or empty", async () => {
    const { parseAllowlist, checkAccess } = await import("../src/access");
    expect(checkAccess(parseAllowlist(undefined), { id: 1 })).toBe("open");
    expect(checkAccess(parseAllowlist(" , "), { id: 1 })).toBe("open");
  });
  it("matches numeric ids and @usernames case-insensitively, denies everyone else", async () => {
    const { parseAllowlist, checkAccess } = await import("../src/access");
    const list = parseAllowlist("12345, @Ola_Nuell,friend");
    expect(checkAccess(list, { id: 12345 })).toBe("id");
    expect(checkAccess(list, { id: 9, username: "ola_nuell" })).toBe("username");
    expect(checkAccess(list, { id: 9, username: "FRIEND" })).toBe("username");
    expect(checkAccess(list, { id: 9, username: "stranger" })).toBe("denied");
    expect(checkAccess(list, { id: 9 })).toBe("denied");
  });
});
