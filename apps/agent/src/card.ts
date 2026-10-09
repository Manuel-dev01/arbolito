import { InlineKeyboard } from "grammy";
import { tokenByAddress } from "@arbolito/config";
import { effectiveRate, fiatOf, fmtAmount, referenceRate, type Reference, type Route } from "@arbolito/router";
import { t, type Lang } from "./i18n";

/** Callback data: "a:<pendingId>:<op>" (≤ 64 bytes). */
export type CardOp = "c" | "x" | "alt";
export const cardData = (id: string, op: CardOp) => `a:${id}:${op}`;
export function parseCardData(data: string): { id: string; op: CardOp } | null {
  const m = /^a:([0-9a-f-]{36}):(c|x|alt)$/.exec(data);
  return m ? { id: m[1]!, op: m[2] as CardOp } : null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

/** Plain-language venue names for the route line. */
function prettyRoute(route: Route): string {
  const sym = (a: string) => tokenByAddress(a).symbol;
  const venue = (v: string) => (v === "textile_rfq" ? "Textile" : v === "uniswap_v3" ? "Uniswap" : v);
  return [sym(route.tokenIn), ...route.legs.map((l) => `→ ${sym(l.quote.tokenOut)} (${venue(l.quote.venue)})`)].join(" ");
}

export interface CardInput {
  route: Route;
  references: Reference[];
  lang: Lang;
  /** Seconds until the quote expires. */
  ttlSeconds: number;
}

/** The route card: what you get, the route, the comparison to official, the minimum, the expiry. HTML. */
export function renderCard({ route, references, lang, ttlSeconds }: CardInput): string {
  const tin = tokenByAddress(route.tokenIn);
  const tout = tokenByAddress(route.tokenOut);
  const [base, quote] = [fiatOf(tin.symbol), fiatOf(tout.symbol)];
  const rate = effectiveRate(route.tokenIn, route.amountIn, route.tokenOut, route.expectedOut);
  const official = referenceRate(references, "official", base, quote);
  const lines = [
    `${t("youGet", lang)} <b>${esc(fmtAmount(route.tokenOut, route.expectedOut, 2))}</b> ${t("forWord", lang)} ${esc(fmtAmount(route.tokenIn, route.amountIn, 2))}`,
    `1 ${base} = ${rate.toLocaleString(lang === "en" ? "en-US" : lang === "pt" ? "pt-BR" : "es-AR", { maximumFractionDigits: 4 })} ${quote}`,
    `${t("route", lang)}: ${esc(prettyRoute(route))}`,
  ];
  if (official) lines.push(`${t("vsOfficial", lang)}: <b>${pct(rate / official - 1)}</b>`);
  lines.push(`${t("minimum", lang)}: ${esc(fmtAmount(route.tokenOut, route.minOut, 2))} · ${t("expiresIn", lang)} ${ttlSeconds}s`);
  return lines.join("\n");
}

export function cardKeyboard(pendingId: string, lang: Lang, hasAlternatives: boolean): InlineKeyboard {
  const kb = new InlineKeyboard().text(t("btnConfirm", lang), cardData(pendingId, "c"));
  if (hasAlternatives) kb.text(t("btnAlternatives", lang), cardData(pendingId, "alt"));
  return kb.text(t("btnCancel", lang), cardData(pendingId, "x"));
}

export function renderAlternatives(best: Route, alternatives: Route[], lang: Lang): string {
  const rows = alternatives.slice(0, 5).map((alt) => {
    const diffBps = Number(((alt.expectedOut - best.expectedOut) * 10_000n) / best.expectedOut);
    return `• ${esc(fmtAmount(alt.tokenOut, alt.expectedOut, 2))} (${diffBps} bps) ${esc(prettyRoute(alt))}`;
  });
  return `<b>${t("alternatives", lang)}</b>\n${rows.join("\n")}`;
}
