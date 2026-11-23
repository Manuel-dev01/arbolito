/**
 * A payout statement is a list of receipts, and its link is that list: /payouts/<id>.<id>… with each
 * receipt UUID as 22 base64url characters. Nothing is stored. Every row comes from an anchored receipt,
 * so the page can't say anything the receipts don't. Payees' names aren't in receipts: the payer may
 * add them to the link's #fragment, which browsers never send to a server.
 */
export const MAX_STATEMENT = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeUuid(id: string): string {
  // 128 bits as 22 base64url digits (the top digit carries the spare 4 bits as zeros).
  let n = BigInt(`0x${id.replace(/-/g, "")}`);
  let out = "";
  for (let i = 0; i < 22; i++) {
    out = B64[Number(n & 63n)]! + out;
    n >>= 6n;
  }
  return out;
}

function decodeUuid(s: string): string | null {
  if (s.length !== 22) return null;
  let n = 0n;
  for (const c of s) {
    const d = B64.indexOf(c);
    if (d < 0) return null;
    n = (n << 6n) | BigInt(d);
  }
  if (n >> 128n) return null;
  const h = n.toString(16).padStart(32, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The statement id for these receipts (order kept, repeats dropped); null when there is nothing valid to list. */
export function statementId(receiptIds: readonly string[]): string | null {
  const ids = [...new Set(receiptIds.map((i) => i.toLowerCase()))];
  if (!ids.length || ids.length > MAX_STATEMENT || ids.some((i) => !UUID.test(i))) return null;
  return ids.map(encodeUuid).join(".");
}

/** The receipt ids in a statement id, or null when it isn't one. */
export function parseStatementId(id: string): string[] | null {
  const parts = id.split(".");
  if (parts.length > MAX_STATEMENT) return null;
  const ids = parts.map(decodeUuid);
  if (ids.some((i) => i === null) || new Set(ids).size !== ids.length) return null;
  return ids as string[];
}

/** Payees' names for the link's fragment, aligned with the receipts. */
export const namesFragment = (names: readonly string[]) => `#n=${names.map((n) => encodeURIComponent(n.slice(0, 40))).join(",")}`;

export function parseNames(hash: string): string[] {
  if (!hash.startsWith("#n=")) return [];
  return hash
    .slice(3)
    .split(",")
    .slice(0, MAX_STATEMENT)
    .map((s) => {
      try {
        return decodeURIComponent(s).slice(0, 40);
      } catch {
        return "";
      }
    });
}
