import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import { TOKENS } from "@arbolito/config";
import type { Reference, Route } from "@arbolito/router";
import { cardData, cardKeyboard, parseCardData, renderAlternatives, renderCard } from "../src/card";
import { langFromTelegram, t } from "../src/i18n";
import { rampLink } from "../src/ripio";
import { deserializeRoute, serializeRoute } from "../src/serde";

const { wBRL, wARS, USDT } = TOKENS;
const route: Route = {
  id: "3f2c1a9e-8b7d-4c6e-9f10-112233445566",
  label: "wBRL →[uniswap 0.01%] USDT →[uniswap 0.01%] wARS",
  legs: [
    {
      quote: { venue: "uniswap_v3", tokenIn: wBRL.address, tokenOut: USDT.address, amountIn: 10n * 10n ** 18n, amountOut: 1_980_000n, blockNumber: 1n, firm: false, raw: { gasEstimate: 1n }, meta: { fee: 100 } },
      minOut: 1_970_100n,
    },
    {
      quote: { venue: "uniswap_v3", tokenIn: USDT.address, tokenOut: wARS.address, amountIn: 1_980_000n, amountOut: 3_177_411_908_400_035_561_279n, blockNumber: 1n, firm: false, raw: {}, meta: { fee: 100 } },
      minOut: 3_161_524_848_857_035_383_472n,
    },
  ],
  tokenIn: wBRL.address,
  tokenOut: wARS.address,
  amountIn: 10n * 10n ** 18n,
  expectedOut: 3_177_411_908_400_035_561_279n,
  minOut: 3_161_524_848_857_035_383_472n,
  taker: zeroAddress,
};
const refs: Reference[] = [{ name: "official", pair: "BRL/ARS", rate: "302.8944", source: "x", at: "y" }];

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

describe("card", () => {
  it("round-trips callback data and rejects anything else", () => {
    expect(parseCardData(cardData(route.id, "c"))).toEqual({ id: route.id, op: "c" });
    expect(parseCardData(cardData(route.id, "alt"))).toEqual({ id: route.id, op: "alt" });
    expect(parseCardData("a:not-a-uuid:c")).toBeNull();
    expect(parseCardData(`a:${route.id}:drain`)).toBeNull();
    expect(cardData(route.id, "alt").length).toBeLessThanOrEqual(64);
  });

  it("renders amounts, the route, vs-official and the expiry in each language", () => {
    const es = renderCard({ route, references: refs, lang: "es", ttlSeconds: 48 });
    expect(es).toContain("Recibís <b>3,177.41 wARS</b> por 10 wBRL");
    expect(es).toContain("wBRL → USDT (Uniswap) → wARS (Uniswap)");
    expect(es).toMatch(/Vs\. oficial: <b>\+\d+\.\d{2}%<\/b>/);
    expect(es).toContain("vence en 48s");
    expect(renderCard({ route, references: refs, lang: "en", ttlSeconds: 5 })).toContain("You get <b>3,177.41 wARS</b> for 10 wBRL");
    expect(renderCard({ route, references: refs, lang: "pt", ttlSeconds: 5 })).toContain("Você recebe");
  });

  it("omits the comparison when there is no official reference", () => {
    expect(renderCard({ route, references: [], lang: "es", ttlSeconds: 5 })).not.toContain("oficial");
  });

  it("escapes HTML in route labels", () => {
    const alt = { ...route, legs: [{ ...route.legs[0]!, quote: { ...route.legs[0]!.quote, venue: "textile_rfq" as const } }] };
    expect(renderAlternatives(route, [alt], "es")).not.toMatch(/<(?!\/?b>)/);
  });

  it("offers alternatives only when there are some", () => {
    const withAlts = cardKeyboard(route.id, "es", true).inline_keyboard.flat().map((b) => b.text);
    const without = cardKeyboard(route.id, "es", false).inline_keyboard.flat().map((b) => b.text);
    expect(withAlts).toEqual(["Confirmar", "Ver alternativas", "Cancelar"]);
    expect(without).toEqual(["Confirmar", "Cancelar"]);
  });
});

describe("serde", () => {
  it("round-trips a route through JSON with bigints intact", () => {
    const back = deserializeRoute(JSON.parse(JSON.stringify(serializeRoute(route))));
    expect(back.amountIn).toBe(route.amountIn);
    expect(back.expectedOut).toBe(route.expectedOut);
    expect(back.minOut).toBe(route.minOut);
    expect(back.legs[1]!.quote.amountOut).toBe(route.legs[1]!.quote.amountOut);
    expect(back.legs[0]!.minOut).toBe(route.legs[0]!.minOut);
    expect(back.legs[0]!.quote.blockNumber).toBe(1n);
  });
});

describe("i18n", () => {
  it("maps Telegram language codes, defaulting to Spanish", () => {
    expect(langFromTelegram("pt-br")).toBe("pt");
    expect(langFromTelegram("en")).toBe("en");
    expect(langFromTelegram(undefined)).toBe("es");
    expect(langFromTelegram("fr")).toBe("es");
  });
  it("never tells the user money moved in error copy", () => {
    for (const lang of ["es", "pt", "en"] as const) {
      expect(t("error", lang)).toMatch(/No se movió|Nenhum dinheiro|No money moved/);
      expect(t("walletNotReady", lang)).toMatch(/no moví nada|nada foi movido|nothing moved/);
    }
  });
});
