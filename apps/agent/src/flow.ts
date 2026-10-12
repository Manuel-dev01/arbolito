/**
 * Card lifecycle orchestration: take a shared quote from the web backend, post the card, then
 * watch it (a timer per card while the process runs, plus a lazy check on every tap) and edit
 * the message on every state change. Nothing here moves money: the user confirms in MiniPay.
 */
import type { Api } from "grammy";
import { log } from "@arbolito/chain";
import type { Db } from "@arbolito/db";
import { quoteErrorCopy, type MiniAppClient, type QuoteErrorCopy } from "./api";
import { isCardPayload, modelOf, payloadWith, renderCard, renderDone, type CardPayload, type CardRequest, type Rendered } from "./card";
import type { QuoteResponse } from "./contract";
import type { Lang } from "./i18n";
import type { Links } from "./links";
import { isFinal, step, type CardEvent, type CardModel } from "./machine";
import { createPending, getCard, getQuoteRow, listWatchedCards, retireSharedQuote, setPendingPayload, transitionPending, type Json, type PendingAction, type User } from "./store";

/** How often a live card checks the shared quote for prepared / submitted / receipt. */
export const CARD_POLL_MS = 5_000;
/** A same-token send has no quote; its card still expires so an old link can't linger. */
export const SEND_CARD_TTL_MS = 10 * 60_000;

export type CreateResult = { ok: true; pendingId: string; quote: QuoteResponse | null } | { ok: false; error: QuoteErrorCopy };

export interface FlowDeps {
  db: Db;
  api: Api;
  client: MiniAppClient;
  links: Links | null;
  /** PUBLIC_BASE_URL, for receipt links when the API returns a relative one. */
  baseUrl?: string | undefined;
  now?: () => number;
  pollMs?: number;
}

type TapOutcome = { kind: "expired" } | { kind: "inMiniPay" } | { kind: "cancelled" } | { kind: "live"; payload: CardPayload } | { kind: "done" };

export class CardFlow {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private readonly pollMs: number;

  constructor(private readonly d: FlowDeps) {
    this.now = d.now ?? Date.now;
    this.pollMs = d.pollMs ?? CARD_POLL_MS;
  }

  // ── Create ──

  async createConvert(user: User, lang: Lang, request: Extract<CardRequest, { kind: "convert" }>): Promise<CreateResult> {
    let quote: QuoteResponse;
    try {
      quote = await this.d.client.quote({ from: request.from, to: request.to, amount: request.amount, lang, ...(user.walletAddress ? { account: user.walletAddress } : {}) });
    } catch (err) {
      log(`[flow] quote ${request.from}->${request.to} failed: ${(err as Error).message}`);
      return { ok: false, error: quoteErrorCopy(err) };
    }
    const payload: CardPayload = { v: 2, lang, request, quote };
    const row = await createPending(this.d.db, user.id, "convert", payload as unknown as Json, new Date(quote.expiresAt));
    return { ok: true, pendingId: row.id, quote };
  }

  async createSend(user: User, lang: Lang, request: Extract<CardRequest, { kind: "send" }>): Promise<CreateResult> {
    let quote: QuoteResponse | null = null;
    if (request.receive && request.receive !== request.token) {
      try {
        quote = await this.d.client.quote({ from: request.token, to: request.receive, amount: request.amount, lang, ...(user.walletAddress ? { account: user.walletAddress } : {}) });
      } catch (err) {
        log(`[flow] send quote ${request.token}->${request.receive} failed: ${(err as Error).message}`);
        return { ok: false, error: quoteErrorCopy(err) };
      }
    }
    const payload: CardPayload = { v: 2, lang, request, quote };
    const expiry = quote ? new Date(quote.expiresAt) : new Date(this.now() + SEND_CARD_TTL_MS);
    const row = await createPending(this.d.db, user.id, "send", payload as unknown as Json, expiry);
    return { ok: true, pendingId: row.id, quote };
  }

  // ── Post and watch ──

  /** Sends the card to the chat, remembers the message, starts the watcher. */
  async post(chatId: number, pendingId: string): Promise<void> {
    const card = await getCard(this.d.db, pendingId);
    if (!card || !isCardPayload(card.payload)) return;
    const p = card.payload;
    const r = this.render(card, p, modelOf(card.status, card.expiresAt, p));
    const msg = await this.d.api.sendMessage(chatId, r.text, { parse_mode: "HTML", reply_markup: r.keyboard, link_preview_options: { is_disabled: true } });
    await setPendingPayload(this.d.db, card.id, { ...p, chatId, messageId: msg.message_id } as unknown as Json);
    this.schedule(card.id, this.delayFor(modelOf(card.status, card.expiresAt, p), !!p.quote));
  }

  /** Re-arms watchers for live cards after a restart; past-expiry ones are edited right away. */
  async resume(): Promise<number> {
    const rows = await listWatchedCards(this.d.db, new Date(this.now() - 24 * 3_600_000));
    let n = 0;
    for (const row of rows) {
      if (!isCardPayload(row.payload) || row.payload.messageId === undefined) continue;
      this.schedule(row.id, 0);
      n++;
    }
    return n;
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private schedule(id: string, delayMs: number) {
    const prev = this.timers.get(id);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      this.timers.delete(id);
      this.refresh(id).catch((err) => log(`[flow] card ${id} refresh failed: ${(err as Error).message}`));
    }, Math.max(0, delayMs));
    this.timers.set(id, timer);
  }

  private delayFor(m: CardModel, hasQuote: boolean): number {
    const untilExpiry = m.expiresAt - this.now() + 250;
    if (m.status === "pending") return hasQuote ? Math.min(this.pollMs, untilExpiry) : untilExpiry;
    return this.pollMs;
  }

  /** One watcher step: read the shared quote, advance the machine, persist, edit, reschedule. */
  async refresh(id: string): Promise<void> {
    const card = await getCard(this.d.db, id);
    if (!card || !isCardPayload(card.payload)) return;
    const p = card.payload;
    const cur = modelOf(card.status, card.expiresAt, p);
    const now = this.now();
    let event: CardEvent = { type: "tick", now };
    if (p.quote) {
      const row = await getQuoteRow(this.d.db, p.quote.quoteId);
      if (row) event = { type: "quoteRow", row, now };
    }
    const next = await this.apply(card, p, cur, step(cur, event));
    if (!isFinal(next, now)) this.schedule(id, this.delayFor(next, !!p.quote));
  }

  /**
   * Persists a transition and edits the message. The status change is a compare-and-set, so a
   * timer and a tap (or two processes) can't both act on the same transition.
   */
  private async apply(card: PendingAction, p: CardPayload, cur: CardModel, next: CardModel): Promise<CardModel> {
    const payload = payloadWith(p, next);
    if (next.status === cur.status) {
      if (next.prepared !== cur.prepared) await setPendingPayload(this.d.db, card.id, payload as unknown as Json);
      return next;
    }
    const won = await transitionPending(this.d.db, card.id, cur.status, next.status, {
      payload: payload as unknown as Json,
      ...(next.receiptId ? { receiptId: next.receiptId } : {}),
    });
    if (!won) {
      const fresh = await getCard(this.d.db, card.id);
      return fresh && isCardPayload(fresh.payload) ? modelOf(fresh.status, fresh.expiresAt, fresh.payload) : next;
    }
    await this.edit(card.id, payload, next);
    if (next.status === "executed" && next.receiptId && payload.chatId !== undefined) await this.sendDone(payload.chatId, payload, next.receiptId);
    return next;
  }

  private render(card: PendingAction, p: CardPayload, m: CardModel): Rendered {
    return renderCard(card.id, m, p, this.d.links, this.now());
  }

  private async edit(id: string, p: CardPayload, m: CardModel): Promise<void> {
    if (p.chatId === undefined || p.messageId === undefined) return;
    const r = renderCard(id, m, p, this.d.links, this.now());
    try {
      await this.d.api.editMessageText(p.chatId, p.messageId, r.text, { parse_mode: "HTML", reply_markup: r.keyboard, link_preview_options: { is_disabled: true } });
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!/message is not modified/i.test(msg)) log(`[flow] edit of card ${id} failed: ${msg}`);
    }
  }

  private async sendDone(chatId: number, p: CardPayload, receiptId: string) {
    const receipt = await this.d.client.receipt(receiptId).catch((err) => {
      log(`[flow] receipt ${receiptId} fetch failed: ${(err as Error).message}`);
      return null;
    });
    const base = (this.d.baseUrl ?? "").replace(/\/$/, "");
    const raw = receipt?.url ?? (base ? `/r/${receiptId}` : null);
    const url = raw && /^https?:\/\//.test(raw) ? raw : raw && base ? `${base}${raw.startsWith("/") ? "" : "/"}${raw}` : null;
    const r = renderDone(p, receipt, url);
    await this.d.api.sendMessage(chatId, r.text, { parse_mode: "HTML", reply_markup: r.keyboard, link_preview_options: { is_disabled: true } });
  }

  // ── Taps (callback buttons on the card) ──

  /** Lazy expiry on any tap: returns the card's state after the check, editing it if it expired. */
  async touch(card: PendingAction): Promise<TapOutcome> {
    if (!isCardPayload(card.payload)) return { kind: "expired" };
    const p = card.payload;
    const cur = modelOf(card.status, card.expiresAt, p);
    const next = await this.apply(card, p, cur, step(cur, { type: "tick", now: this.now() }));
    if (next.status === "pending") return { kind: "live", payload: payloadWith(p, next) };
    if (next.status === "expired") return { kind: "expired" };
    return { kind: "done" };
  }

  /** "Cancelar": refused once the mini app prepared the calls (the wallet may be signing). */
  async cancel(card: PendingAction): Promise<TapOutcome> {
    if (!isCardPayload(card.payload)) return { kind: "expired" };
    const p = card.payload;
    let cur = modelOf(card.status, card.expiresAt, p);
    const now = this.now();
    if (p.quote && cur.status === "pending" && !cur.prepared) {
      // Retire the shared quote first; if the mini app already took it, it can't be cancelled here.
      const retired = await retireSharedQuote(this.d.db, p.quote.quoteId);
      if (!retired) {
        const row = await getQuoteRow(this.d.db, p.quote.quoteId);
        if (row) cur = await this.apply(card, p, cur, step(cur, { type: "quoteRow", row, now }));
      }
    }
    const next = await this.apply(card, p, cur, step(cur, { type: "cancel", now }));
    if (next.status === "cancelled") {
      const t = this.timers.get(card.id);
      if (t) clearTimeout(t);
      this.timers.delete(card.id);
      return { kind: "cancelled" };
    }
    if (next.status === "pending") return { kind: "inMiniPay" };
    if (next.status === "expired") return { kind: "expired" };
    return { kind: "done" };
  }
}
