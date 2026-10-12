import { describe, expect, it } from "vitest";
import { CONFIRMED_WATCH_MS, PREPARED_GRACE_MS, canDeepLink, isFinal, step, type CardModel, type QuoteRowSnapshot } from "../src/machine";
import { NOW, model } from "./fixtures";

const EXP = NOW + 48_000;
const row = (status: string, over: Partial<QuoteRowSnapshot> = {}): QuoteRowSnapshot => ({ status, receiptId: null, error: null, ...over });
const after = (m: CardModel, r: QuoteRowSnapshot, now = NOW) => step(m, { type: "quoteRow", row: r, now });

describe("card state machine", () => {
  it("stays live before expiry and expires at the deadline (timer tick or lazy tap)", () => {
    expect(step(model(), { type: "tick", now: EXP - 1 }).status).toBe("pending");
    expect(step(model(), { type: "tick", now: EXP }).status).toBe("expired");
    expect(after(model(), row("quoted"), EXP + 5).status).toBe("expired");
    expect(canDeepLink(model(), EXP - 1)).toBe(true);
    expect(canDeepLink(model(), EXP)).toBe(false);
  });

  it("can never deep-link once expired, cancelled, confirmed, executed or failed", () => {
    for (const status of ["expired", "cancelled", "confirmed", "executed", "failed"] as const) expect(canDeepLink(model({ status }), NOW)).toBe(false);
  });

  it("an expired card that was never prepared is final, and nothing revives it", () => {
    const expired = step(model(), { type: "tick", now: EXP });
    expect(isFinal(expired, EXP)).toBe(true);
    for (const r of [row("submitted"), row("failed"), row("quoted", { receiptId: "x" }), row("prepared")]) expect(after(expired, r, EXP + 1).status).toBe("expired");
    expect(step(expired, { type: "cancel", now: EXP + 1 }).status).toBe("expired");
  });

  it("cancel works on a live card, not on a prepared one (the wallet may be signing)", () => {
    expect(step(model(), { type: "cancel", now: NOW })).toMatchObject({ status: "cancelled", cancelledIn: "telegram" });
    expect(step(model({ prepared: true }), { type: "cancel", now: NOW }).status).toBe("pending");
    expect(step(model(), { type: "cancel", now: EXP }).status).toBe("expired");
  });

  it("follows the shared quote: prepared → submitted → receipt", () => {
    const prepared = after(model(), row("prepared"));
    expect(prepared).toMatchObject({ status: "pending", prepared: true });
    const confirmed = after(prepared, row("submitted"));
    expect(confirmed.status).toBe("confirmed");
    expect(after(confirmed, row("submitted")).status).toBe("confirmed");
    const done = after(confirmed, row("submitted", { receiptId: "r1" }));
    expect(done).toMatchObject({ status: "executed", receiptId: "r1" });
    expect(isFinal(done, NOW)).toBe(true);
  });

  it("a prepared card that expires keeps watching, and a late send still shows as processing", () => {
    const expired = step(model({ prepared: true }), { type: "tick", now: EXP });
    expect(expired.status).toBe("expired");
    expect(isFinal(expired, EXP)).toBe(false);
    expect(isFinal(expired, EXP + PREPARED_GRACE_MS)).toBe(true);
    expect(after(expired, row("submitted"), EXP + 1000).status).toBe("confirmed");
  });

  it("maps failures: price moved, rejected in MiniPay, anything else", () => {
    expect(after(model(), row("failed", { error: "price_changed: below minOut" }))).toMatchObject({ status: "failed", failReason: "price_changed" });
    expect(after(model(), row("failed", { error: "User rejected the request" }))).toMatchObject({ status: "cancelled", cancelledIn: "minipay" });
    expect(after(model({ status: "confirmed" }), row("failed", { error: "reverted" }))).toMatchObject({ status: "failed", failReason: "other" });
  });

  it("a confirmed card stops watching after the watch window", () => {
    const c = model({ status: "confirmed" });
    expect(isFinal(c, EXP)).toBe(false);
    expect(isFinal(c, EXP + CONFIRMED_WATCH_MS)).toBe(true);
  });

  it("a quote retired by the backend expires the card", () => {
    expect(after(model(), row("expired")).status).toBe("expired");
  });
});
