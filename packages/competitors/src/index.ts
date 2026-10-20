/**
 * What Western Union pays, read live from its own currency-converter pages in a browser rented
 * through buy (x402, paid in USDT by Arbolito's buy payer). Quotes and receipts compare against it.
 *
 * Why a rented browser: the pages compute the amount client-side (a plain fetch gets no number),
 * and buy's browser exposes an accessibility snapshot (raw page text is blocked by its policy).
 * Remitly was tried and dropped: its page crashed the session, and it doesn't pay out pesos.
 */
export type Corridor = "USD-ARS" | "USD-BRL";

export const WESTERN_UNION_PAGES: Record<Corridor, string> = {
  "USD-ARS": "https://www.westernunion.com/us/en/currency-converter/usd-to-ars-rate.html",
  "USD-BRL": "https://www.westernunion.com/us/en/currency-converter/usd-to-brl-rate.html",
};

export interface CompetitorRate {
  provider: "western_union";
  corridor: Corridor;
  /** Local currency per US dollar, as the page computed it (before the provider's transfer fee). */
  rate: number;
  sendAmount: number;
  receiveAmount: number;
  sourceUrl: string;
}

const NUM = /:\s*([\d,]+(?:\.\d+)?)\s*$/;

/**
 * Reads the converter's two boxes from a snapshot: "Send Amount" (US$) and the box after it (what
 * the receiver gets). Null when the page hasn't computed the amount yet or the layout changed.
 */
export function parseWesternUnion(snapshot: string, corridor: Corridor): CompetitorRate | null {
  const lines = snapshot.split("\n");
  const i = lines.findIndex((l) => /textbox "Send Amount/.test(l));
  if (i < 0) return null;
  const next = lines.slice(i + 1).find((l) => /- textbox /.test(l));
  const send = NUM.exec(lines[i]!)?.[1];
  const receive = next ? NUM.exec(next)?.[1] : undefined;
  if (!send || !receive) return null;
  const sendAmount = Number(send.replace(/,/g, ""));
  const receiveAmount = Number(receive.replace(/,/g, ""));
  if (!(sendAmount > 0) || !(receiveAmount > 0)) return null;
  return { provider: "western_union", corridor, rate: receiveAmount / sendAmount, sendAmount, receiveAmount, sourceUrl: WESTERN_UNION_PAGES[corridor] };
}

/** Sane bounds against our own reference (fiat per US$): outside them the reading is discarded. */
export function plausible(rate: number, reference: number, maxDevPct = 25): boolean {
  return reference > 0 && Math.abs(rate / reference - 1) * 100 <= maxDevPct;
}

/** % more (positive) or less local currency Arbolito delivers than the competitor, per dollar. */
export function advantagePct(ourRate: number, theirRate: number): number {
  return Math.round((ourRate / theirRate - 1) * 10_000) / 100;
}

export * from "./browser";
