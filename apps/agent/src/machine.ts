/**
 * Quote card lifecycle, as a pure state machine. The bot persists `status` in
 * pending_actions.status and edits its own Telegram message on every change, so an old card can
 * never deep-link to a confirm.
 *
 *   pending ──expiry──▶ expired            (terminal unless the wallet already had the calls)
 *   pending ──cancel──▶ cancelled          (refused once the mini app prepared the calls)
 *   pending | expired(†) ──submitted──▶ confirmed ──receipt──▶ executed
 *   pending | expired(†) | confirmed ──failed──▶ failed | cancelled (rejected in MiniPay)
 *
 * (†) only when `prepared`: the mini app returned calls to the wallet, so a send may still land
 * after the quote's expiry. Copy never says "no money moved" for a prepared card that expired.
 */

export type CardStatus = "pending" | "confirmed" | "executed" | "cancelled" | "expired" | "failed";

export interface CardModel {
  status: CardStatus;
  /** Quote (or send card) expiry, epoch ms. */
  expiresAt: number;
  /** The mini app prepared calls for this quote (miniapp_quotes.status reached "prepared"). */
  prepared: boolean;
  /** Where a cancel came from. */
  cancelledIn?: "telegram" | "minipay";
  failReason?: "price_changed" | "other";
  receiptId?: string;
}

/** The shared quote row as the web backend keeps it (miniapp_quotes). */
export interface QuoteRowSnapshot {
  /** quoted | prepared | submitted | expired | failed */
  status: string;
  receiptId: string | null;
  error: string | null;
}

export type CardEvent =
  | { type: "tick"; now: number }
  | { type: "cancel"; now: number }
  | { type: "quoteRow"; row: QuoteRowSnapshot; now: number };

/** How long after expiry a prepared card keeps watching for the wallet's send. */
export const PREPARED_GRACE_MS = 10 * 60_000;
/** How long after expiry a confirmed card keeps watching for its receipt. */
export const CONFIRMED_WATCH_MS = 30 * 60_000;

/** True only while the primary "Confirmar en MiniPay" link may be shown. */
export function canDeepLink(m: CardModel, now: number): boolean {
  return m.status === "pending" && now < m.expiresAt;
}

/** No further state can be reached; the watcher stops. */
export function isFinal(m: CardModel, now: number): boolean {
  switch (m.status) {
    case "executed":
    case "failed":
    case "cancelled":
      return true;
    case "expired":
      return !m.prepared || now >= m.expiresAt + PREPARED_GRACE_MS;
    case "confirmed":
      return now >= m.expiresAt + CONFIRMED_WATCH_MS;
    case "pending":
      return false;
  }
}

const REJECTED = /reject|denied|cancel/i;

export function step(m: CardModel, e: CardEvent): CardModel {
  // Lazy expiry first: whatever else happens, a past-expiry pending card is expired.
  const expire = (x: CardModel, now: number): CardModel => (x.status === "pending" && now >= x.expiresAt ? { ...x, status: "expired" } : x);

  switch (e.type) {
    case "tick":
      return expire(m, e.now);

    case "cancel": {
      const cur = expire(m, e.now);
      if (cur.status !== "pending" || cur.prepared) return cur;
      return { ...cur, status: "cancelled", cancelledIn: "telegram" };
    }

    case "quoteRow": {
      const { row } = e;
      // Outcomes can arrive while pending, after a prepared card expired, or while confirmed.
      const open = m.status === "pending" || m.status === "confirmed" || (m.status === "expired" && m.prepared);
      if (open && row.receiptId) return { ...m, status: "executed", receiptId: row.receiptId };
      if (open && row.status === "failed") {
        if (row.error && REJECTED.test(row.error)) return { ...m, status: "cancelled", cancelledIn: "minipay" };
        return { ...m, status: "failed", failReason: row.error && /price_changed/.test(row.error) ? "price_changed" : "other" };
      }
      if (open && row.status === "submitted" && m.status !== "confirmed") return { ...m, status: "confirmed" };
      if (m.status === "pending" && row.status === "prepared" && !m.prepared) return expire({ ...m, prepared: true }, e.now);
      if (m.status === "pending" && row.status === "expired") return { ...m, status: "expired" };
      return expire(m, e.now);
    }
  }
}
