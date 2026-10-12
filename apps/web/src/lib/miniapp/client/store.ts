/**
 * Phone-local state (MiniPay rule: no sign-in, so the phone keeps the user's own lists).
 * Every read/write is guarded: storage may be unavailable, and the app must still render.
 */
import type { Cur, Lang } from "./format";

export interface Contact {
  id: string;
  name: string;
  /** Free label shown after the currency: "Mamá", "Alquiler". */
  tag: string;
  phone: string;
  /** The currency they receive in. */
  cur: Cur;
  /** Their MiniPay wallet, resolved from the phone or picked from MiniPay's contacts. Never shown on primary screens. */
  address: string | null;
}

export interface ReceiptIndexEntry {
  receiptId: string;
  kind: "change" | "send";
  /** Contact name for sends. */
  to?: string;
  at: string;
}

export interface PendingSubmit {
  quoteId: string;
  txHashes: string[];
  at: string;
}

const PREFIX = "arbolito.mp.";

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function defaultKV(): KV | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function createStore(kv: KV | null = defaultKV()) {
  const read = <T>(key: string, fallback: T): T => {
    try {
      const raw = kv?.getItem(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key: string, value: unknown) => {
    try {
      if (value === null || value === undefined) kv?.removeItem(PREFIX + key);
      else kv?.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* storage full or blocked: the UI keeps working from memory */
    }
  };
  const acct = (account: string) => account.toLowerCase();

  return {
    lang: () => read<Lang | null>("lang", null),
    setLang: (l: Lang) => write("lang", l),
    onboarded: (account: string) => read<boolean>(`onboarded.${acct(account)}`, false),
    setOnboarded: (account: string) => write(`onboarded.${acct(account)}`, true),

    contacts: (account: string) => read<Contact[]>(`contacts.${acct(account)}`, []),
    saveContact(account: string, c: Contact) {
      const list = read<Contact[]>(`contacts.${acct(account)}`, []).filter((x) => x.id !== c.id);
      write(`contacts.${acct(account)}`, [...list, c]);
    },

    receipts: (account: string) => read<ReceiptIndexEntry[]>(`receipts.${acct(account)}`, []),
    addReceipt(account: string, e: ReceiptIndexEntry) {
      const list = read<ReceiptIndexEntry[]>(`receipts.${acct(account)}`, []).filter((x) => x.receiptId !== e.receiptId);
      write(`receipts.${acct(account)}`, [e, ...list].slice(0, 100));
    },

    cachedBalances: <T>(account: string) => read<{ at: number; data: T } | null>(`balances.${acct(account)}`, null),
    cacheBalances: <T>(account: string, data: T) => write(`balances.${acct(account)}`, { at: Date.now(), data }),

    pendingSubmits: (account: string) => read<PendingSubmit[]>(`pending.${acct(account)}`, []),
    setPendingSubmits: (account: string, list: PendingSubmit[]) => write(`pending.${acct(account)}`, list.length ? list : null),

    /** Set when the user leaves for Ripio, so returning lands on "Esperando tu envío". */
    pendingRipio: (account: string) => read<{ at: number; sym: string; before: string } | null>(`ripio.${acct(account)}`, null),
    setPendingRipio: (account: string, v: { at: number; sym: string; before: string } | null) => write(`ripio.${acct(account)}`, v),
  };
}

export type Store = ReturnType<typeof createStore>;

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
