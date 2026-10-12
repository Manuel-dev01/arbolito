import type { CardPayload } from "../src/card";
import type { QuoteResponse } from "../src/contract";
import type { CardModel } from "../src/machine";

export const NOW = Date.parse("2026-10-11T13:42:00.000Z");
export const CARD_ID = "11111111-2222-4333-8444-555555555555";
export const QUOTE_ID = "3f2c1a9e-8b7d-4c6e-9f10-112233445566";
const E18 = 10n ** 18n;

/** "pasá 100 dólares a pesos" from the design (4a). */
export const quote: QuoteResponse = {
  quoteId: QUOTE_ID,
  expiresAt: new Date(NOW + 48_000).toISOString(),
  from: "USDT",
  to: "wARS",
  amountIn: "100000000",
  expectedOut: (160_800n * E18).toString(),
  minOut: (159_996n * E18).toString(),
  rate: "1608",
  vsOfficial: { pct: 4.08, pair: "USD/ARS", deltaOut: (6_300n * E18).toString() },
  steps: 1,
  venues: ["uniswap"],
  usesTextile: false,
  alternatives: [{ expectedOut: (160_092n * E18).toString(), venues: ["textile", "uniswap"], diffBps: -44 }],
  references: [],
};

export const convertPayload = (lang: CardPayload["lang"] = "es", over: Partial<CardPayload> = {}): CardPayload => ({
  v: 2,
  lang,
  request: { kind: "convert", from: "USDT", to: "wARS", amount: "100" },
  quote,
  chatId: 42,
  messageId: 7,
  ...over,
});

export const model = (over: Partial<CardModel> = {}): CardModel => ({ status: "pending", expiresAt: NOW + 48_000, prepared: false, ...over });
