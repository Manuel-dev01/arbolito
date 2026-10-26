import { describe, expect, it } from "vitest";
import type { InlineKeyboardMarkup } from "grammy/types";
import {
  LINK_NEW,
  LINK_WHAT,
  cardData,
  parseCardData,
  parseRetryData,
  renderAlternatives,
  renderCard,
  renderDone,
  renderLinkCode,
  renderLinked,
  renderNeedLink,
  renderNoMarket,
  renderWelcome,
  retryData,
  type CardPayload,
} from "../src/card";
import type { ReceiptResponse } from "../src/contract";
import { LANGS } from "../src/i18n";
import { makeLinks, wrapForMiniPay } from "../src/links";
import type { CardStatus } from "../src/machine";
import { CARD_ID, NOW, QUOTE_ID, convertPayload, model, quote } from "./fixtures";

const links = makeLinks("https://arbolito.example/")!;
const texts = (k: InlineKeyboardMarkup) => k.inline_keyboard.map((row) => row.map((b) => b.text));
const urls = (k: InlineKeyboardMarkup) => k.inline_keyboard.flat().flatMap((b) => ("url" in b && b.url ? [b.url] : []));
const callbacks = (k: InlineKeyboardMarkup) => k.inline_keyboard.flat().flatMap((b) => ("callback_data" in b && b.callback_data ? [b.callback_data] : []));
/** Visible text: tags stripped, entities decoded. */
const visible = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** Only Telegram's HTML tags, with nothing dynamic leaking in as markup. */
const onlyTelegramTags = (html: string) => (html.match(/<[^>]*>/g) ?? []).every((tag) => /^<\/?(b|i|s|code)>$|^<a href="[^"<>]*">$|^<\/a>$/.test(tag));

describe("callback data", () => {
  it("round-trips card ops, retries and rejects anything else", () => {
    for (const op of ["x", "alt", "rq"] as const) {
      expect(parseCardData(cardData(CARD_ID, op))).toEqual({ id: CARD_ID, op });
      expect(cardData(CARD_ID, op).length).toBeLessThanOrEqual(64);
    }
    expect(parseCardData(`a:${CARD_ID}:c`)).toEqual({ id: CARD_ID, op: "c" }); // legacy Confirm, retired on tap
    expect(parseCardData(`a:${CARD_ID}:drain`)).toBeNull();
    expect(parseCardData("a:not-a-uuid:x")).toBeNull();
    expect(parseRetryData(retryData("wBRL", "wARS", "500.25"))).toEqual({ from: "wBRL", to: "wARS", amount: "500.25" });
    expect(parseRetryData("r:DOGE:wARS:1")).toBeNull();
    expect(parseRetryData("r:wBRL:wARS:1e9")).toBeNull();
    expect(retryData("USDC", "wBRL", "123456789012345678901234567890.123456789012345678").length).toBeLessThanOrEqual(64);
  });
});

describe("live quote card (ledger, 4a)", () => {
  it("renders the design's Spanish card exactly", () => {
    const r = renderCard(CARD_ID, model(), convertPayload("es"), links, NOW);
    expect(r.text).toBe(
      [
        "Recibís <b>ARS 160.800,00</b>",
        "por US$ 100,00",
        "",
        "Cotización  <code>1 US$ = ARS 1.608</code>",
        "vs oficial  <b>+4,08%</b> · ARS 6.300 más",
        "Ruta  directo, por el mejor mercado",
        "Mínimo garantizado  <code>ARS 159.996,00</code>",
        "",
        "⏱ Vence en <b>48 s</b>.",
      ].join("\n"),
    );
  });

  it("renders English with en-US separators and Portuguese wording", () => {
    const en = renderCard(CARD_ID, model(), convertPayload("en"), links, NOW).text;
    expect(en).toContain("You get <b>ARS 160,800.00</b>\nfor US$ 100.00");
    expect(en).toContain("Rate  <code>1 US$ = ARS 1,608</code>");
    expect(en).toContain("vs official  <b>+4.08%</b> · ARS 6,300 more");
    expect(en).toContain("Guaranteed minimum  <code>ARS 159,996.00</code>");
    const pt = renderCard(CARD_ID, model(), convertPayload("pt"), links, NOW).text;
    expect(pt).toContain("Você recebe <b>ARS 160.800,00</b>");
    expect(pt).toContain("Mínimo garantido  <code>ARS 159.996,00</code>");
    expect(pt).toContain("⏱ Expira em <b>48 s</b>");
  });

  it("fits one phone screen in every language", () => {
    for (const lang of LANGS) {
      const lines = visible(renderCard(CARD_ID, model(), convertPayload(lang), links, NOW).text).split("\n");
      expect(lines.length).toBeLessThanOrEqual(10);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(46);
    }
  });

  it("row 1 is the Confirmar en MiniPay link to this exact quote; row 2 the secondary actions", () => {
    const es = renderCard(CARD_ID, model(), convertPayload("es"), links, NOW).keyboard;
    expect(texts(es)).toEqual([["Confirmar en MiniPay ↗"], ["Ver alternativas", "Cancelar"]]);
    expect(urls(es)).toEqual([`https://arbolito.example/app?quote=${QUOTE_ID}`]);
    expect(callbacks(es)).toEqual([cardData(CARD_ID, "alt"), cardData(CARD_ID, "x")]);
    expect(texts(renderCard(CARD_ID, model(), convertPayload("pt"), links, NOW).keyboard)[0]).toEqual(["Confirmar no MiniPay ↗"]);
    expect(texts(renderCard(CARD_ID, model(), convertPayload("en"), links, NOW).keyboard)[0]).toEqual(["Confirm in MiniPay ↗"]);
  });

  it("drops 'Ver alternativas' when there are none, and the URL row when no mini app URL is configured", () => {
    const p = convertPayload("es", { quote: { ...quote, alternatives: [] } });
    expect(texts(renderCard(CARD_ID, model(), p, links, NOW).keyboard)).toEqual([["Confirmar en MiniPay ↗"], ["Cancelar"]]);
    expect(texts(renderCard(CARD_ID, model(), p, null, NOW).keyboard)).toEqual([["Cancelar"]]);
  });

  it("shows 2 pasos, omits vs oficial without a reference, and never shows a negative delta as 'más'", () => {
    const p = convertPayload("es", { quote: { ...quote, steps: 2, vsOfficial: { pct: -1.5, pair: "USD/ARS", deltaOut: "-100" } } });
    const text = renderCard(CARD_ID, model(), p, links, NOW).text;
    expect(text).toContain("Ruta  2 pasos, por el mejor mercado");
    expect(text).toContain("vs oficial  <b>-1,50%</b>\n");
    expect(renderCard(CARD_ID, model(), convertPayload("es", { quote: { ...quote, vsOfficial: null } }), links, NOW).text).not.toContain("oficial");
  });
});

describe("card states (the bot edits its own message)", () => {
  const all: CardStatus[] = ["pending", "confirmed", "executed", "cancelled", "expired", "failed"];

  it("an expired card strikes the amount, says no money moved and offers only a new quote", () => {
    const r = renderCard(CARD_ID, model({ status: "expired" }), convertPayload("es"), links, NOW + 60_000);
    expect(r.text).toBe("<s>Recibís ARS 160.800,00 por US$ 100,00</s>\n\n<b>Esta cotización venció. No se movió plata.</b>");
    expect(texts(r.keyboard)).toEqual([["Pedir nueva cotización"]]);
    expect(callbacks(r.keyboard)).toEqual([cardData(CARD_ID, "rq")]);
    expect(urls(r.keyboard)).toEqual([]);
  });

  it("a pending card rendered after its expiry renders as expired (no stale confirm link)", () => {
    const r = renderCard(CARD_ID, model(), convertPayload("es"), links, NOW + 48_000);
    expect(r.text).toContain("<s>");
    expect(urls(r.keyboard)).toEqual([]);
  });

  it("no state other than a live pending card ever carries a URL button", () => {
    for (const lang of LANGS)
      for (const status of all)
        for (const now of [NOW, NOW + 48_000, NOW + 3_600_000]) {
          const r = renderCard(CARD_ID, model({ status }), convertPayload(lang), links, now);
          const live = status === "pending" && now < NOW + 48_000;
          expect(urls(r.keyboard).length > 0).toBe(live);
          expect(onlyTelegramTags(r.text)).toBe(true);
        }
  });

  it("an expired prepared card doesn't claim no money moved", () => {
    const r = renderCard(CARD_ID, model({ status: "expired", prepared: true }), convertPayload("es"), links, NOW + 60_000);
    expect(r.text).toContain("Si ya confirmaste en MiniPay");
    expect(r.text).not.toContain("No se movió");
  });

  it("processing, done, failed and cancelled read per the design", () => {
    const p = convertPayload("es");
    expect(renderCard(CARD_ID, model({ status: "confirmed" }), p, links, NOW).text).toBe("Recibís <b>ARS 160.800,00</b> por US$ 100,00\n✓ Confirmado en MiniPay. Cambiando…");
    expect(renderCard(CARD_ID, model({ status: "executed" }), p, links, NOW).text).toBe("Recibís <b>ARS 160.800,00</b> por US$ 100,00\n✓ Listo.");
    const failed = renderCard(CARD_ID, model({ status: "failed", failReason: "price_changed" }), p, links, NOW);
    expect(failed.text).toContain("<b>No pudimos hacer el cambio. No se movió plata.</b>\nTus US$ 100,00 siguen en tu MiniPay.");
    expect(failed.text).toContain("El precio cayó debajo del mínimo garantizado");
    expect(texts(failed.keyboard)).toEqual([["Pedir nueva cotización"]]);
    const cancelled = renderCard(CARD_ID, model({ status: "cancelled", cancelledIn: "telegram" }), p, links, NOW);
    expect(cancelled.text).toContain("Cancelado. <b>No se movió plata.</b>");
    expect(texts(cancelled.keyboard)).toEqual([["Volver a cotizar"]]);
    expect(renderCard(CARD_ID, model({ status: "cancelled", cancelledIn: "minipay" }), p, links, NOW).text).toContain("Cancelaste en MiniPay. <b>No se movió plata.</b>");
  });

  it("every no-money-moved state says so in each language", () => {
    for (const lang of LANGS)
      for (const status of ["expired", "cancelled", "failed"] as const) {
        const text = renderCard(CARD_ID, model({ status }), convertPayload(lang), links, NOW + 60_000).text;
        expect(text).toMatch(/<b>[^<]*(No se movió plata|Nenhum dinheiro foi movido|No money moved)\.<\/b>/);
      }
  });
});

describe("send cards", () => {
  const plain = (recipient: string, lang: CardPayload["lang"] = "es"): CardPayload => ({
    v: 2,
    lang,
    request: { kind: "send", recipient, to: "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c", amount: "200", token: "wBRL" },
    quote: null,
    chatId: 1,
    messageId: 2,
  });

  it("deep-links to the mini app's send flow with recipient, address, amount and token", () => {
    const r = renderCard(CARD_ID, model({ expiresAt: NOW + 600_000 }), plain("Lucía Gómez"), links, NOW);
    expect(r.text).toBe("Mandás <b>R$ 200,00</b> a <b>Lucía Gómez</b>\n<code>0x7e03…6c3c</code>\n\n⏱ Vence en <b>10 min</b>");
    const u = new URL(urls(r.keyboard)[0]!);
    expect(u.pathname).toBe("/app");
    expect(Object.fromEntries(u.searchParams)).toEqual({ send: "Lucía Gómez", to: "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c", amount: "200", token: "wBRL" });
  });

  it("a converting send shows what the recipient gets and carries the shared quote", () => {
    const p: CardPayload = {
      ...plain("Lucía", "pt"),
      request: { kind: "send", recipient: "Lucía", to: "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c", amount: "100", token: "USDT", receive: "wARS" },
      quote: { ...quote, steps: 2 },
    };
    const r = renderCard(CARD_ID, model(), p, links, NOW);
    expect(r.text).toContain("<b>Lucía recebe ARS 160.800,00</b>\npor US$ 100,00 · <b>+4,08%</b> vs oficial");
    expect(r.text).toContain("Trocamos em 2 passos pelo melhor mercado. Mínimo garantido <code>ARS 159.996,00</code>.");
    expect(texts(r.keyboard)[0]).toEqual(["Confirmar no MiniPay ↗"]);
    const u = new URL(urls(r.keyboard)[0]!);
    expect(u.searchParams.get("receive")).toBe("wARS");
    expect(u.searchParams.get("quote")).toBe(QUOTE_ID);
  });

  it("escapes contact names everywhere (and URL-encodes them in the link)", () => {
    const evil = `<a href="x">Bob</a> & <b>`;
    for (const status of ["pending", "expired", "cancelled", "confirmed", "failed"] as const) {
      const r = renderCard(CARD_ID, model({ status, expiresAt: NOW + 600_000 }), plain(evil), links, NOW);
      expect(onlyTelegramTags(r.text)).toBe(true);
      expect(visible(r.text)).toContain(evil);
    }
    const u = new URL(urls(renderCard(CARD_ID, model({ expiresAt: NOW + 600_000 }), plain(evil), links, NOW).keyboard)[0]!);
    expect(u.searchParams.get("send")).toBe(evil);
    expect(u.host).toBe("arbolito.example");
  });
});

describe("links", () => {
  it("builds the quote, send and link URLs from the base, with or without a trailing slash", () => {
    const l = makeLinks("https://mini.example/base/")!;
    expect(l.quote(QUOTE_ID)).toBe(`https://mini.example/base/app?quote=${QUOTE_ID}`);
    expect(l.link("0042")).toBe("https://mini.example/base/app/link?code=0042");
    expect(makeLinks(undefined)).toBeNull();
    expect(makeLinks("javascript:alert(1)")).toBeNull();
  });
  it("can wrap every link in a MiniPay deeplink template once one is confirmed", () => {
    expect(wrapForMiniPay("https://a.example/app?quote=1", "https://wallet.example/open?url={url}")).toBe("https://wallet.example/open?url=https%3A%2F%2Fa.example%2Fapp%3Fquote%3D1");
    expect(wrapForMiniPay("https://a.example/app", null)).toBe("https://a.example/app");
    expect(makeLinks("https://a.example", "https://wallet.example/open?url={url}")!.link("1234")).toContain("url=https%3A%2F%2Fa.example%2Fapp%2Flink%3Fcode%3D1234");
  });
});

describe("other messages", () => {
  it("/start for an unlinked user: welcome, why MiniPay, connect + what-is buttons; name escaped", () => {
    const r = renderWelcome("es", "Lu<cía>", null);
    expect(r.text).toContain("Hola, Lu&lt;cía&gt;. Soy <b>Arbolito</b>");
    expect(r.text).toContain("Para mover tu plata necesito tu <b>MiniPay</b>");
    expect(texts(r.keyboard)).toEqual([["Conectá tu MiniPay"], ["¿Qué es MiniPay?"]]);
    expect(callbacks(r.keyboard)).toEqual([LINK_NEW, LINK_WHAT]);
    const linked = renderWelcome("en", null, "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c");
    expect(linked.text).toContain("Your MiniPay <b>0x7e03…6c3c</b> is connected");
    expect(linked.keyboard.inline_keyboard).toEqual([]);
    expect(renderNeedLink("pt").text).toContain("<b>MiniPay</b>");
  });

  it("link code: shown with a URL into the mini app; used and expired states edit it", () => {
    const active = renderLinkCode("active", "0482", "es", links);
    expect(active.text).toBe("Tu código: <code>0482</code>\nEn MiniPay abrí Arbolito → <b>Ajustes → Telegram</b> y escribilo ahí. Vence en 10 min.");
    expect(texts(active.keyboard)).toEqual([["Conectar en MiniPay ↗"]]);
    expect(urls(active.keyboard)).toEqual(["https://arbolito.example/app/link?code=0482"]);
    const expired = renderLinkCode("expired", "0482", "en", links);
    expect(expired.text).toContain("<s>0482</s>");
    expect(urls(expired.keyboard)).toEqual([]);
    expect(texts(expired.keyboard)).toEqual([["Get a new code"]]);
    expect(renderLinkCode("used", "0482", "pt", links).keyboard.inline_keyboard).toEqual([]);
    expect(renderLinked("es", "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c")).toBe(
      "<b>Listo, conectado.</b> ✓\nTelegram ya usa tu MiniPay <b>0x7e03…6c3c</b>.\n\nProbá escribirme <i>pasá 100 dólares a pesos</i> o mandame un audio.",
    );
  });

  it("no market: the pair in plain words, no money moved, a retry button with the same request", () => {
    const r = renderNoMarket("wBRL", "wARS", "500", "es");
    expect(r.text).toBe("Ahora no hay mercado para <b>reales → pesos</b>. Pasa unos minutos cuando hay mucho movimiento. <b>No se movió plata.</b>");
    expect(callbacks(r.keyboard)).toEqual(["r:wBRL:wARS:500"]);
    expect(renderNoMarket("wBRL", "wARS", "500", "pt").text).toContain("reais → pesos");
  });

  it("done: a new message with the receipt link, savings and share button", () => {
    const receipt: ReceiptResponse = {
      receiptId: "a7f3a7f3-0000-4000-8000-000000000029",
      status: "verified",
      url: "https://arbolito.example/r/a7f3",
      from: "USDT",
      to: "wARS",
      amountIn: quote.amountIn,
      amountOut: quote.expectedOut,
      savings: { pct: 4.08, deltaOut: (6_300n * 10n ** 18n).toString(), pair: "USD/ARS" },
      executionTx: "0xab",
      anchorTx: null,
      createdAt: new Date(NOW).toISOString(),
    };
    const r = renderDone(convertPayload("es"), receipt, receipt.url);
    expect(r.text).toBe(
      "<b>Listo.</b> Recibiste <b>ARS 160.800,00</b> por US$ 100,00.\n+4,08% vs oficial · ARS 6.300 más que al oficial.\n\nComprobante <a href=\"https://arbolito.example/r/a7f3\">arbolito.example/r/a7f3</a>\nCualquiera puede verificarlo.",
    );
    expect(texts(r.keyboard)).toEqual([["Ver comprobante ↗", "Compartir"]]);
    expect(urls(r.keyboard)[1]).toBe("https://t.me/share/url?url=https%3A%2F%2Farbolito.example%2Fr%2Fa7f3");
  });

  it("alternatives list each venue and the difference", () => {
    expect(renderAlternatives(quote, "es")).toBe("<b>Alternativas</b>\n• ARS 160.092,00 · Textile + Uniswap · -0,44%");
  });

  it("uses only the design's emoji (⏱ 🎙️ ✓)", () => {
    const all = [
      ...LANGS.flatMap((l) => [renderCard(CARD_ID, model(), convertPayload(l), links, NOW).text, renderWelcome(l, "A", null).text, renderLinked(l, "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c")]),
    ].join("\n");
    const emoji = all.match(/\p{Extended_Pictographic}/gu) ?? [];
    expect(emoji.length).toBeGreaterThan(0);
    for (const e of emoji) expect(["⏱", "✓", "🎙"]).toContain(e);
  });
});
