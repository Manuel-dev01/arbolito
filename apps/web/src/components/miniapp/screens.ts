/** Every Mini App screen (design/Arbolito Mini App.dc.html), its header and its in-app ‹ parent. */
import type { MiniDict } from "../../i18n/miniapp";

export const SCREENS = [
  "no-minipay", "conn-fail", "welcome", "add", "add-ripio", "add-waiting", "done-ob",
  "home", "chat",
  "change", "quote-loading", "quote", "quote-expired", "quote-changed", "quote-nomarket", "alts", "processing", "done", "failed", "cancelled", "tg-quote",
  "send", "send-add", "send-amount", "send-quote", "send-done",
  "auto-intro", "auto-limits", "auto-contacts", "auto-consent", "auto-on",
  "security", "revoke", "receipts", "receipt", "settings", "withdraw",
] as const;

export type Screen = (typeof SCREENS)[number];

export const isScreen = (s: unknown): s is Screen => typeof s === "string" && (SCREENS as readonly string[]).includes(s);

type TitleKey = keyof Pick<MiniDict, "hAdd" | "hChange" | "hQuote" | "hAlts" | "hSend" | "hAddContact" | "hReceipt" | "hAuto" | "hSecurity" | "hWithdraw" | "hContacts">;

/** [header title, parent for the in-app ‹ when there is no history to pop]. */
export const HEADER: Partial<Record<Screen, [TitleKey | "sendTo", Screen]>> = {
  add: ["hAdd", "welcome"], "add-ripio": ["hAdd", "add"],
  change: ["hChange", "home"], "quote-loading": ["hQuote", "change"], quote: ["hQuote", "change"], "quote-expired": ["hQuote", "change"], "quote-changed": ["hQuote", "change"], "quote-nomarket": ["hQuote", "change"], alts: ["hAlts", "quote"],
  send: ["hSend", "home"], "send-add": ["hAddContact", "send"], "send-amount": ["sendTo", "send"], "send-quote": ["sendTo", "send-amount"],
  "auto-intro": ["hAuto", "home"], "auto-limits": ["hAuto", "auto-intro"], "auto-contacts": ["hAuto", "auto-limits"], "auto-consent": ["hAuto", "auto-contacts"],
  security: ["hSecurity", "settings"], revoke: ["hSecurity", "security"], receipt: ["hReceipt", "receipts"], withdraw: ["hWithdraw", "home"],
};

export const STEP: Partial<Record<Screen, string>> = { "auto-intro": "1/4", "auto-limits": "2/4", "auto-contacts": "3/4", "auto-consent": "4/4" };

export const TABS: { screen: Screen; key: "tabHome" | "tabChat" | "tabReceipts" | "tabSettings" }[] = [
  { screen: "home", key: "tabHome" },
  { screen: "chat", key: "tabChat" },
  { screen: "receipts", key: "tabReceipts" },
  { screen: "settings", key: "tabSettings" },
];

export const TAB_SCREENS: readonly Screen[] = ["home", "chat", "receipts", "settings"];

/**
 * ?state= values (mock mode) → the screen to open plus the mock scenario that produces it.
 * Covers every design state, including the derived ones (home-loading, home-empty, send-empty…).
 */
export const STATE_ALIASES: Record<string, { screen: Screen; scenario?: Record<string, boolean> }> = {
  "home-loading": { screen: "home", scenario: { slowBalances: true } },
  "home-empty": { screen: "home", scenario: { emptyBalances: true, noReceipts: true } },
  "home-offline": { screen: "home", scenario: { offline: true } },
  "home-paused": { screen: "home", scenario: { autoOn: true, paused: true } },
  "receipts-empty": { screen: "receipts", scenario: { noReceipts: true } },
  "send-empty": { screen: "send", scenario: { noContacts: true } },
  "security-on": { screen: "security", scenario: { autoOn: true } },
  "security-paused": { screen: "security", scenario: { autoOn: true, paused: true } },
};
