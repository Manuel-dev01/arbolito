/**
 * Telegram rendering: HTML text + inline keyboards for every card state, linking and results.
 * Buttons follow the design: row 1 is the primary action, row 2 up to two secondary actions.
 * Everything dynamic is escaped or produced by money.ts; model output never comes through here.
 */
import { parseUnits } from "viem";
import type { InlineKeyboardButton, InlineKeyboardMarkup } from "grammy/types";
import type { QuoteResponse, ReceiptResponse, Sym } from "./contract";
import { copy, esc, t, type Lang } from "./i18n";
import type { Links } from "./links";
import { shareLink } from "./links";
import { canDeepLink, type CardModel, type CardStatus } from "./machine";
import { currencyName, decimalsOf, formatPct, maskWallet, money, rateLine } from "./money";

// ── Callback data (≤ 64 bytes) ─────────────────────────────────────────────

/** Card ops: cancel, alternatives, re-quote. "c" is the pre-MiniPay Confirm, kept only to retire old cards. */
export type CardOp = "x" | "alt" | "rq" | "c";
export const cardData = (id: string, op: Exclude<CardOp, "c">) => `a:${id}:${op}`;
export function parseCardData(data: string): { id: string; op: CardOp } | null {
  const m = /^a:([0-9a-f-]{36}):(x|alt|rq|c)$/.exec(data);
  return m ? { id: m[1]!, op: m[2] as CardOp } : null;
}

/** "Probar de nuevo" after no market: the pair and amount travel in the button itself. */
export const retryData = (from: Sym, to: Sym, amount: string) => `r:${from}:${to}:${amount}`;
export function parseRetryData(data: string): { from: Sym; to: Sym; amount: string } | null {
  const m = /^r:(wARS|wBRL|USDT|USAT|USDC):(wARS|wBRL|USDT|USAT|USDC):(\d{1,30}(?:\.\d{1,18})?)$/.exec(data);
  return m ? { from: m[1] as Sym, to: m[2] as Sym, amount: m[3]! } : null;
}

export const LINK_NEW = "l:new";
export const LINK_WHAT = "l:what";

// ── Card payload (pending_actions.payload, v2) ─────────────────────────────

export type CardRequest =
  | { kind: "convert"; from: Sym; to: Sym; amount: string }
  | {
      kind: "send";
      /** Contact name, or the address the user typed. */
      recipient: string;
      /** Resolved recipient wallet. */
      to: string;
      amount: string;
      token: Sym;
      receive?: Sym;
    };

export interface CardPayload {
  v: 2;
  lang: Lang;
  request: CardRequest;
  /** The shared quote from the web backend (null for a same-token send). */
  quote: QuoteResponse | null;
  chatId?: number;
  messageId?: number;
  prepared?: boolean;
  cancelledIn?: "telegram" | "minipay";
  failReason?: "price_changed" | "other";
  receiptId?: string;
}

export function isCardPayload(x: unknown): x is CardPayload {
  return !!x && typeof x === "object" && (x as { v?: unknown }).v === 2 && typeof (x as { request?: unknown }).request === "object";
}

export function modelOf(status: string, expiresAt: Date, p: CardPayload): CardModel {
  const known: CardStatus[] = ["pending", "confirmed", "executed", "cancelled", "expired", "failed"];
  return {
    status: (known as string[]).includes(status) ? (status as CardStatus) : "expired",
    expiresAt: expiresAt.getTime(),
    prepared: !!p.prepared,
    ...(p.cancelledIn ? { cancelledIn: p.cancelledIn } : {}),
    ...(p.failReason ? { failReason: p.failReason } : {}),
    ...(p.receiptId ? { receiptId: p.receiptId } : {}),
  };
}

/** Folds a model back into the payload fields it owns. */
export function payloadWith(p: CardPayload, m: CardModel): CardPayload {
  const next: CardPayload = { ...p, prepared: m.prepared };
  if (m.cancelledIn) next.cancelledIn = m.cancelledIn;
  if (m.failReason) next.failReason = m.failReason;
  if (m.receiptId) next.receiptId = m.receiptId;
  return next;
}

// ── Rendering ──────────────────────────────────────────────────────────────

export interface Rendered {
  text: string;
  keyboard: InlineKeyboardMarkup;
}

const kb = (...rows: InlineKeyboardButton[][]): InlineKeyboardMarkup => ({ inline_keyboard: rows.filter((r) => r.length > 0) });
const cb = (text: string, data: string): InlineKeyboardButton => ({ text, callback_data: data });
const url = (text: string, href: string): InlineKeyboardButton => ({ text, url: href });

const who = (r: Extract<CardRequest, { kind: "send" }>) => esc(r.recipient.startsWith("0x") ? maskWallet(r.recipient) : r.recipient);
const humanAtomic = (sym: Sym, amount: string) => parseUnits(amount, decimalsOf(sym));
const delta = (s: string): bigint | null => (/^-?\d+$/.test(s) ? BigInt(s) : null);

/** The card's one-line summary, bold or (for strike-through) plain. */
function headline(p: CardPayload, bold: boolean): string {
  const b = (s: string) => (bold ? `<b>${s}</b>` : s);
  const { lang, request: r, quote: q } = p;
  if (r.kind === "convert" && q) return `${copy.youGet[lang]} ${b(money(q.to, q.expectedOut, lang))} ${copy.forWord[lang]} ${money(q.from, q.amountIn, lang)}`;
  if (r.kind === "send" && q) return `${b(copy.recipientGets(lang, who(r), money(q.to, q.expectedOut, lang)))} ${copy.forWord[lang]} ${money(q.from, q.amountIn, lang)}`;
  if (r.kind === "send") return copy.youSend(lang, b(money(r.token, humanAtomic(r.token, r.amount), lang)), b(who(r)));
  // A convert card always carries its quote; this is only reachable with a corrupt payload.
  return `${esc(r.amount)} ${r.from} → ${r.to}`;
}

function liveText(p: CardPayload, secondsLeft: number): string {
  const { lang, request: r, quote: q } = p;
  if (r.kind === "convert" && q) {
    const lines = [`${copy.youGet[lang]} <b>${money(q.to, q.expectedOut, lang)}</b>`, `${copy.forWord[lang]} ${money(q.from, q.amountIn, lang)}`, ""];
    lines.push(`${copy.rateLabel[lang]}  <code>${rateLine(q.from, q.to, q.rate, lang)}</code>`);
    if (q.vsOfficial) {
      const d = delta(q.vsOfficial.deltaOut);
      lines.push(`${copy.vsOfficial[lang]}  <b>${formatPct(q.vsOfficial.pct, lang)}</b>${d !== null && d > 0n ? ` · ${money(q.to, d, lang, 0)} ${copy.more[lang]}` : ""}`);
    }
    lines.push(`${copy.routeLabel[lang]}  ${copy.route(lang, q.steps)}`);
    lines.push(`${copy.minimum[lang]}  <code>${money(q.to, q.minOut, lang)}</code>`, "", copy.expiresIn(lang, secondsLeft));
    return lines.join("\n");
  }
  if (r.kind === "send" && q) {
    const vs = q.vsOfficial ? ` · <b>${formatPct(q.vsOfficial.pct, lang)}</b> ${copy.vsOfficial[lang]}` : "";
    return [
      `<b>${copy.recipientGets(lang, who(r), money(q.to, q.expectedOut, lang))}</b>`,
      `${copy.forWord[lang]} ${money(q.from, q.amountIn, lang)}${vs}`,
      `${copy.convertSteps(lang, q.steps)} ${copy.minimum[lang]} <code>${money(q.to, q.minOut, lang)}</code>.`,
      "",
      copy.expiresInShort(lang, secondsLeft),
    ].join("\n");
  }
  if (r.kind === "send") {
    const addr = r.recipient.startsWith("0x") ? "" : `\n<code>${maskWallet(r.to)}</code>`;
    return `${headline(p, true)}${addr}\n\n${copy.expiresInShort(lang, secondsLeft)}`;
  }
  return headline(p, false);
}

function confirmUrl(p: CardPayload, links: Links | null): string | null {
  if (!links) return null;
  const r = p.request;
  if (r.kind === "convert") return p.quote ? links.quote(p.quote.quoteId) : null;
  return links.send({
    recipient: r.recipient,
    to: r.to,
    amount: r.amount,
    token: r.token,
    ...(r.receive && r.receive !== r.token ? { receive: r.receive } : {}),
    ...(p.quote ? { quoteId: p.quote.quoteId } : {}),
  });
}

/**
 * The card for its current state. The confirm URL is rendered ONLY while canDeepLink holds;
 * every other state replaces it with a callback (or nothing).
 */
export function renderCard(id: string, model: CardModel, p: CardPayload, links: Links | null, now: number): Rendered {
  const { lang } = p;
  const status = model.status === "pending" && !canDeepLink(model, now) ? "expired" : model.status;
  const struck = `<s>${headline(p, false)}</s>`;
  switch (status) {
    case "pending": {
      const href = confirmUrl(p, links);
      const secondary = [
        ...(p.quote && p.quote.alternatives.length > 0 ? [cb(t("btnAlternatives", lang), cardData(id, "alt"))] : []),
        cb(t("btnCancel", lang), cardData(id, "x")),
      ];
      const secondsLeft = Math.max(0, Math.ceil((model.expiresAt - now) / 1000));
      return { text: liveText(p, secondsLeft), keyboard: kb(href ? [url(t("btnConfirm", lang), href)] : [], secondary) };
    }
    case "expired":
      return { text: `${struck}\n\n${model.prepared ? copy.expiredPrepared[lang] : copy.expired[lang]}`, keyboard: kb([cb(t("btnRequote", lang), cardData(id, "rq"))]) };
    case "cancelled":
      return {
        text: `${struck}\n\n${model.cancelledIn === "minipay" ? copy.cancelledMiniPay[lang] : copy.cancelledTelegram[lang]}`,
        keyboard: kb([cb(t("btnQuoteAgain", lang), cardData(id, "rq"))]),
      };
    case "confirmed":
      return { text: `${headline(p, true)}\n${copy.processing(lang, p.request.kind)}`, keyboard: kb() };
    case "executed":
      return { text: `${headline(p, true)}\n${copy.doneLine[lang]}`, keyboard: kb() };
    case "failed": {
      const paid = p.quote ? money(p.quote.from, p.quote.amountIn, lang) : p.request.kind === "send" ? money(p.request.token, humanAtomic(p.request.token, p.request.amount), lang) : "";
      const reason = model.failReason === "price_changed" ? `\n\n${copy.failedPriceChanged[lang]}` : "";
      return { text: `${struck}\n\n${copy.failed(lang, paid)}${reason}`, keyboard: kb([cb(t("btnRequote", lang), cardData(id, "rq"))]) };
    }
  }
}

const VENUE: Record<string, string> = { uniswap: "Uniswap", textile: "Textile" };

export function renderAlternatives(q: QuoteResponse, lang: Lang): string {
  const rows = q.alternatives.slice(0, 5).map((a) => `• ${money(q.to, a.expectedOut, lang)} · ${a.venues.map((v) => VENUE[v] ?? esc(v)).join(" + ")} · ${formatPct(a.diffBps / 100, lang)}`);
  return `<b>${t("alternatives", lang)}</b>\n${rows.join("\n")}`;
}

/** The result message after a receipt lands (a new message; the card itself was edited). */
export function renderDone(p: CardPayload, receipt: ReceiptResponse | null, receiptUrl: string | null): Rendered {
  const { lang, request: r, quote: q } = p;
  const to = receipt?.to ?? q?.to ?? (r.kind === "send" ? r.receive ?? r.token : r.to);
  const from = receipt?.from ?? q?.from ?? (r.kind === "send" ? r.token : r.from);
  const out = receipt?.amountOut ?? q?.expectedOut ?? null;
  const inn = receipt?.amountIn ?? q?.amountIn ?? null;
  const got = out ? money(to, out, lang) : "";
  const lines = [r.kind === "send" ? copy.doneSend(lang, who(r), got) : copy.done(lang, got, inn ? money(from, inn, lang) : "")];
  const sav = receipt ? receipt.savings : q?.vsOfficial ?? null;
  if (sav && sav.pct > 0) {
    const d = delta(sav.deltaOut);
    lines.push(copy.savings(lang, formatPct(sav.pct, lang), d !== null && d > 0n ? money(to, d, lang, 0) : null));
  }
  if (receiptUrl) {
    const shown = esc(receiptUrl.replace(/^https?:\/\//, ""));
    lines.push("", copy.receiptLine(lang, `<a href="${esc(receiptUrl)}">${shown}</a>`));
  }
  return { text: lines.join("\n"), keyboard: receiptUrl ? kb([url(t("btnReceipt", lang), receiptUrl), url(t("btnShare", lang), shareLink(receiptUrl))]) : kb() };
}

export function renderNoMarket(from: Sym, to: Sym, amount: string, lang: Lang): Rendered {
  return { text: copy.noMarket(lang, `${currencyName(from, lang)} → ${currencyName(to, lang)}`), keyboard: kb([cb(t("btnRetry", lang), retryData(from, to, amount))]) };
}

// ── Welcome and linking ────────────────────────────────────────────────────

export function renderWelcome(lang: Lang, firstName: string | null, wallet: string | null): Rendered {
  const hello = copy.welcome(lang, firstName ? esc(firstName.slice(0, 64)) : null);
  if (wallet) return { text: `${hello}\n\n${copy.welcomeLinked(lang, maskWallet(wallet))}`, keyboard: kb() };
  return { text: `${hello}\n\n${copy.welcomeUnlinked[lang]}`, keyboard: kb([cb(t("btnConnect", lang), LINK_NEW)], [cb(t("btnWhatIsMiniPay", lang), LINK_WHAT)]) };
}

export function renderNeedLink(lang: Lang): Rendered {
  return { text: t("needLink", lang), keyboard: kb([cb(t("btnConnect", lang), LINK_NEW)], [cb(t("btnWhatIsMiniPay", lang), LINK_WHAT)]) };
}

export function renderAlreadyLinked(lang: Lang, wallet: string): Rendered {
  return { text: copy.alreadyLinked(lang, maskWallet(wallet)), keyboard: kb([cb(t("btnConnectAnother", lang), LINK_NEW)]) };
}

export type LinkCodeState = "active" | "used" | "expired";

export function renderLinkCode(state: LinkCodeState, code: string, lang: Lang, links: Links | null): Rendered {
  const c = esc(code);
  if (state === "used") return { text: copy.linkCodeUsed(lang, c), keyboard: kb() };
  if (state === "expired") return { text: copy.linkCodeExpired(lang, c), keyboard: kb([cb(t("btnNewCode", lang), LINK_NEW)]) };
  return { text: copy.linkCode(lang, c), keyboard: kb(links ? [url(t("btnConnectUrl", lang), links.link(code))] : []) };
}

export function renderLinked(lang: Lang, wallet: string): string {
  return copy.linked(lang, maskWallet(wallet));
}
