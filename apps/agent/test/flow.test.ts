/**
 * CardFlow wiring with an in-memory store and a fake Telegram API: the card is posted with the
 * confirm link, then the watcher edits it on expiry / processing / done, and taps act lazily.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { MiniAppApiError, type MiniAppClient } from "../src/api";
import { CardFlow } from "../src/flow";
import { makeLinks } from "../src/links";
import type { PendingAction, User } from "../src/store";
import { NOW, QUOTE_ID, quote } from "./fixtures";

const mem = vi.hoisted(() => ({
  cards: new Map<string, Record<string, unknown>>(),
  quoteRows: new Map<string, { status: string; receiptId: string | null; error: string | null }>(),
  seq: 0,
}));

vi.mock("../src/store", () => ({
  async createPending(_db: unknown, userId: string, kind: string, payload: unknown, expiry: number | Date) {
    const id = `00000000-0000-4000-8000-${String(++mem.seq).padStart(12, "0")}`;
    const row = { id, userId, kind, payload, status: "pending", expiresAt: typeof expiry === "number" ? new Date(Date.now() + expiry) : expiry, createdAt: new Date() };
    mem.cards.set(id, row);
    return { ...row };
  },
  async getCard(_db: unknown, id: string) {
    const r = mem.cards.get(id);
    return r ? structuredClone(r) : undefined;
  },
  async setPendingPayload(_db: unknown, id: string, payload: unknown) {
    mem.cards.get(id)!.payload = structuredClone(payload);
  },
  async transitionPending(_db: unknown, id: string, from: string, to: string, patch: { payload?: unknown } = {}) {
    const r = mem.cards.get(id);
    if (!r || r.status !== from) return false;
    r.status = to;
    if (patch.payload) r.payload = structuredClone(patch.payload);
    return true;
  },
  async listWatchedCards() {
    return [...mem.cards.values()].filter((r) => r.status === "pending" || r.status === "confirmed");
  },
  async getQuoteRow(_db: unknown, quoteId: string) {
    return mem.quoteRows.get(quoteId);
  },
  async retireSharedQuote(_db: unknown, quoteId: string) {
    const r = mem.quoteRows.get(quoteId);
    if (!r || r.status !== "quoted") return false;
    r.status = "expired";
    r.error = "cancelled_in_telegram";
    return true;
  },
}));

const user = { id: "u1", walletAddress: "0x7e0316b2533f6df2e651295a9b11481bb8346c3c" } as User;
const urls = (k?: InlineKeyboardMarkup) => (k?.inline_keyboard ?? []).flat().flatMap((b) => ("url" in b && b.url ? [b.url] : []));

function setup(client?: Partial<MiniAppClient>) {
  const sendMessage = vi.fn(async (_chat: number, _text: string, _o?: { reply_markup?: InlineKeyboardMarkup }) => ({ message_id: 99 }));
  const editMessageText = vi.fn(async (_chat: number, _msg: number, _text: string, _o?: { reply_markup?: InlineKeyboardMarkup }) => true);
  const api = { sendMessage, editMessageText } as unknown as Api;
  const miniapp: MiniAppClient = {
    quote: vi.fn(async () => quote),
    receipt: vi.fn(async () => {
      throw new MiniAppApiError("upstream", 503, "down");
    }),
    ...client,
  };
  const flow = new CardFlow({ db: {} as never, api, client: miniapp, links: makeLinks("https://mini.example"), baseUrl: "https://web.example", pollMs: 5_000 });
  return { flow, sendMessage, editMessageText, miniapp };
}

const theCard = () => [...mem.cards.values()][0] as unknown as PendingAction;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mem.cards.clear();
  mem.quoteRows.clear();
  mem.quoteRows.set(QUOTE_ID, { status: "quoted", receiptId: null, error: null });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("CardFlow", () => {
  it("asks the backend for a quote with the linked wallet and the conversation language", async () => {
    const { flow, miniapp } = setup();
    const r = await flow.createConvert(user, "pt", { kind: "convert", from: "USDT", to: "wARS", amount: "100" });
    expect(r.ok).toBe(true);
    expect(miniapp.quote).toHaveBeenCalledWith({ from: "USDT", to: "wARS", amount: "100", lang: "pt", account: user.walletAddress });
    expect(theCard().expiresAt.toISOString()).toBe(quote.expiresAt);
  });

  it("maps a no-route quote to the no-market copy and stores nothing", async () => {
    const { flow } = setup({ quote: vi.fn(async () => Promise.reject(new MiniAppApiError("no_route", 422, "none"))) });
    expect(await flow.createConvert(user, "es", { kind: "convert", from: "wBRL", to: "wARS", amount: "500" })).toEqual({ ok: false, error: "noMarket" });
    expect(mem.cards.size).toBe(0);
  });

  it("posts the card with the confirm link, then edits it at expiry so it can't be confirmed", async () => {
    const { flow, sendMessage, editMessageText } = setup();
    const r = await flow.createConvert(user, "es", { kind: "convert", from: "USDT", to: "wARS", amount: "100" });
    await flow.post(42, (r as { pendingId: string }).pendingId);
    expect(urls(sendMessage.mock.calls[0]![2]!.reply_markup)).toEqual([`https://mini.example/app?quote=${QUOTE_ID}`]);
    expect(theCard().payload).toMatchObject({ chatId: 42, messageId: 99 });

    await vi.advanceTimersByTimeAsync(45_000);
    expect(editMessageText).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(theCard().status).toBe("expired");
    expect(editMessageText).toHaveBeenCalledTimes(1);
    const [chat, msg, text, opts] = editMessageText.mock.calls[0]!;
    expect([chat, msg]).toEqual([42, 99]);
    expect(text).toContain("<s>Recibís ARS 160.800,00 por US$ 100,00</s>");
    expect(text).toContain("No se movió plata");
    expect(urls(opts!.reply_markup)).toEqual([]);

    await vi.advanceTimersByTimeAsync(600_000);
    expect(editMessageText).toHaveBeenCalledTimes(1); // final: the watcher stopped
  });

  it("follows the shared quote to processing and done, with the receipt as a new message", async () => {
    const { flow, sendMessage, editMessageText } = setup();
    const r = await flow.createConvert(user, "es", { kind: "convert", from: "USDT", to: "wARS", amount: "100" });
    await flow.post(42, (r as { pendingId: string }).pendingId);

    mem.quoteRows.set(QUOTE_ID, { status: "prepared", receiptId: null, error: null });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(editMessageText).not.toHaveBeenCalled();
    expect(theCard().payload).toMatchObject({ prepared: true });

    mem.quoteRows.set(QUOTE_ID, { status: "submitted", receiptId: null, error: null });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(theCard().status).toBe("confirmed");
    expect(editMessageText.mock.calls.at(-1)![2]).toContain("✓ Confirmado en MiniPay. Cambiando…");

    const receiptId = "a7f3a7f3-0000-4000-8000-000000000029";
    mem.quoteRows.set(QUOTE_ID, { status: "submitted", receiptId, error: null });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(theCard().status).toBe("executed");
    expect(editMessageText.mock.calls.at(-1)![2]).toContain("✓ Listo.");
    const done = sendMessage.mock.calls.at(-1)!;
    expect(done[1]).toContain("<b>Listo.</b> Recibiste <b>ARS 160.800,00</b>");
    expect(urls(done[2]!.reply_markup)[0]).toBe(`https://web.example/r/${receiptId}`);
  });

  it("a prepared card that expires doesn't claim no money moved, and a late send still reports", async () => {
    const { flow, editMessageText } = setup();
    const r = await flow.createConvert(user, "es", { kind: "convert", from: "USDT", to: "wARS", amount: "100" });
    await flow.post(42, (r as { pendingId: string }).pendingId);
    mem.quoteRows.set(QUOTE_ID, { status: "prepared", receiptId: null, error: null });
    await vi.advanceTimersByTimeAsync(50_000);
    expect(theCard().status).toBe("expired");
    expect(editMessageText.mock.calls.at(-1)![2]).not.toContain("No se movió");
    mem.quoteRows.set(QUOTE_ID, { status: "submitted", receiptId: null, error: null });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(theCard().status).toBe("confirmed");
  });

  it("cancel retires the shared quote and edits the card; refused once MiniPay has it", async () => {
    const { flow, editMessageText } = setup();
    const a = await flow.createConvert(user, "es", { kind: "convert", from: "USDT", to: "wARS", amount: "100" });
    await flow.post(42, (a as { pendingId: string }).pendingId);
    expect(await flow.cancel(theCard())).toEqual({ kind: "cancelled" });
    expect(mem.quoteRows.get(QUOTE_ID)).toMatchObject({ status: "expired", error: "cancelled_in_telegram" });
    expect(editMessageText.mock.calls.at(-1)![2]).toContain("Cancelado. <b>No se movió plata.</b>");

    mem.cards.clear();
    mem.quoteRows.set(QUOTE_ID, { status: "prepared", receiptId: null, error: null });
    const b = await flow.createConvert(user, "es", { kind: "convert", from: "USDT", to: "wARS", amount: "100" });
    await flow.post(42, (b as { pendingId: string }).pendingId);
    editMessageText.mockClear();
    expect(await flow.cancel(theCard())).toEqual({ kind: "inMiniPay" });
    expect(theCard().status).toBe("pending");
    expect(editMessageText).not.toHaveBeenCalled();
  });

  it("a tap after expiry edits the card lazily (e.g. after a restart lost the timer)", async () => {
    const { flow, editMessageText } = setup();
    const r = await flow.createConvert(user, "es", { kind: "convert", from: "USDT", to: "wARS", amount: "100" });
    await flow.post(42, (r as { pendingId: string }).pendingId);
    flow.stop();
    vi.setSystemTime(NOW + 60_000);
    expect(await flow.touch(theCard())).toEqual({ kind: "expired" });
    expect(theCard().status).toBe("expired");
    expect(urls(editMessageText.mock.calls.at(-1)![3]!.reply_markup)).toEqual([]);
    // A second tap doesn't edit again.
    await flow.touch(theCard());
    expect(editMessageText).toHaveBeenCalledTimes(1);
  });

  it("resume re-arms live cards after a restart", async () => {
    const first = setup();
    const r = await first.flow.createConvert(user, "es", { kind: "convert", from: "USDT", to: "wARS", amount: "100" });
    await first.flow.post(42, (r as { pendingId: string }).pendingId);
    first.flow.stop();
    const second = setup();
    expect(await second.flow.resume()).toBe(1);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(theCard().status).toBe("expired");
    expect(second.editMessageText).toHaveBeenCalledTimes(1);
  });
});
