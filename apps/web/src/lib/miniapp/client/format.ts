/**
 * Mini App UI-edge formatting. Amounts stay bigint atomic units until here.
 * Deterministic separators per language (no reliance on the WebView's ICU data):
 * es/pt group with "." and use "," for decimals ("ARS 3.177,41", "R$ 10,00"); en uses "," and ".".
 */
import type { Sym } from "../contract";

export type Lang = "es" | "pt" | "en";
/** The fiat a user thinks in. Tokens map onto these; the UI never shows token tickers on primary screens. */
export type Cur = "ARS" | "BRL" | "USD";

export const CURS: readonly Cur[] = ["ARS", "BRL", "USD"];

export const DECIMALS: Record<Sym, number> = { wARS: 18, wBRL: 18, USDT: 6, USAT: 6, USDC: 6 };
export const CUR_OF: Record<Sym, Cur> = { wARS: "ARS", wBRL: "BRL", USDT: "USD", USAT: "USD", USDC: "USD" };
/** Token used when the user picks a currency (dollars default to USDT, MiniPay's main dollar). */
export const SYM_OF: Record<Cur, Sym> = { ARS: "wARS", BRL: "wBRL", USD: "USDT" };
/** Money prefix ("R$ 10,00"). */
export const PREFIX: Record<Cur, string> = { ARS: "ARS", BRL: "R$", USD: "US$" };
/** Glyph inside the round currency badge. */
export const GLYPH: Record<Cur, string> = { ARS: "$", BRL: "R$", USD: "US$" };

const SEP: Record<Lang, { group: string; dec: string }> = {
  es: { group: ".", dec: "," },
  pt: { group: ".", dec: "," },
  en: { group: ",", dec: "." },
};

export const decimalKey = (lang: Lang): string => SEP[lang].dec;

const abs = (x: bigint) => (x < 0n ? -x : x);

function group(int: string, sep: string): string {
  let out = "";
  for (let i = 0; i < int.length; i++) {
    if (i > 0 && (int.length - i) % 3 === 0) out += sep;
    out += int[i];
  }
  return out;
}

/** Rounds (half away from zero) an atomic amount to `dp` places, returned scaled by 10^dp. */
export function roundAtomic(amount: bigint, decimals: number, dp: number): bigint {
  if (dp >= decimals) return amount * 10n ** BigInt(dp - decimals);
  const div = 10n ** BigInt(decimals - dp);
  const q = abs(amount) / div;
  const r = abs(amount) % div;
  const v = r * 2n >= div ? q + 1n : q;
  return amount < 0n ? -v : v;
}

/** "3.177,41" (es/pt) or "3,177.41" (en). Exact bigint rounding. */
export function fmtNumber(amount: bigint, decimals: number, lang: Lang, dp = 2): string {
  const scaled = roundAtomic(amount, decimals, dp);
  const neg = scaled < 0n;
  const a = abs(scaled);
  const unit = 10n ** BigInt(dp);
  const int = group((a / unit).toString(), SEP[lang].group);
  const frac = dp > 0 ? SEP[lang].dec + (a % unit).toString().padStart(dp, "0") : "";
  return `${neg ? "-" : ""}${int}${frac}`;
}

/** "ARS 3.177,41", "R$ 10,00", "US$ 860.00". `signed` prefixes "+" / "−". */
export function fmtMoney(amount: bigint, decimals: number, cur: Cur, lang: Lang, o: { dp?: number; signed?: boolean } = {}): string {
  const dp = o.dp ?? 2;
  const n = fmtNumber(abs(amount), decimals, lang, dp);
  const sign = amount < 0n ? "−" : o.signed && amount > 0n ? "+" : "";
  return `${sign}${PREFIX[cur]} ${n}`;
}

/** Money for a token's atomic amount, shown in its fiat: fmtSym(3177411900000000000000n, "wARS", "es") → "ARS 3.177,41". */
export function fmtSym(amount: bigint | string, sym: Sym, lang: Lang, o: { dp?: number; signed?: boolean } = {}): string {
  return fmtMoney(typeof amount === "string" ? BigInt(amount) : amount, DECIMALS[sym], CUR_OF[sym], lang, o);
}

/**
 * A comparison vs the official rate is "savings" only when the user got more than at the official
 * rate (buying dollars with pesos usually costs more than official). Otherwise it's shown neutrally.
 */
export function gainOf<T extends { deltaOut: string }>(s: T | null | undefined): T | null {
  return s && BigInt(s.deltaOut) > 0n ? s : null;
}

/** The saved amount: whole pesos and reais, cents for dollars (a dollar gain is usually under $1). */
export function fmtSaved(deltaOut: string | bigint, sym: Sym, lang: Lang): string {
  return fmtSym(deltaOut, sym, lang, { dp: CUR_OF[sym] === "USD" ? 2 : 0 });
}

/** "+5,24%" / "+5.24%" from a percentage number (5.24). */
export function fmtPct(pct: number, lang: Lang): string {
  const bps = BigInt(Math.round(pct * 100));
  const s = fmtNumber(abs(bps), 2, lang, 2);
  return `${bps < 0n ? "−" : "+"}${s}%`;
}

/** Parses a non-negative decimal string ("10.5", ".5", "10.") into atomic units; extra digits truncate. */
export function parseHuman(value: string, decimals: number): bigint {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) throw new Error(`not an amount: ${value}`);
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(m[1] || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

/** Keypad string → the API's HumanAmount ("10." → "10", "0.50" stays). Null if zero or empty. */
export function toApiAmount(typed: string): string | null {
  const t = typed.endsWith(".") ? typed.slice(0, -1) : typed;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  if (/^0+(\.0+)?$/.test(t)) return null;
  return t.replace(/^0+(?=\d)/, "");
}

/** Atomic → keypad string, truncated to 2 decimals and without trailing zeros ("1240", "10.5"). */
export function atomicToTyped(amount: bigint, decimals: number): string {
  const cents = decimals >= 2 ? amount / 10n ** BigInt(decimals - 2) : amount * 10n ** BigInt(2 - decimals);
  const int = (cents / 100n).toString();
  const frac = (cents % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** What the keypad shows while typing: "R$ 1.240,5" keeps a trailing decimal key ("R$ 10,"). */
export function fmtTyped(typed: string, cur: Cur, lang: Lang): string {
  const [i, d] = typed.split(".");
  const int = group(String(BigInt(i || "0")), SEP[lang].group);
  return `${PREFIX[cur]} ${int}${typed.includes(".") ? SEP[lang].dec + (d ?? "") : ""}`;
}

const RATE_ONE = 10n ** 18n;

/**
 * Human rate line in the design's shape: when 1 from-unit buys ≥ 1 to-unit, "1 R$ = ARS 317,74";
 * otherwise invert so the number stays readable: "1 US$ = R$ 5,06".
 */
export function fmtRateLine(rate: string, from: Sym, to: Sym, lang: Lang): string {
  const r = parseHuman(rate, 18);
  const f = CUR_OF[from];
  const t = CUR_OF[to];
  if (r === 0n) return `1 ${PREFIX[f]} = ${PREFIX[t]} 0`;
  if (r >= RATE_ONE) return `1 ${PREFIX[f]} = ${fmtMoney(r, 18, t, lang)}`;
  return `1 ${PREFIX[t]} = ${fmtMoney((RATE_ONE * RATE_ONE) / r, 18, f, lang)}`;
}

/**
 * Masks a phone number for display, keeping the prefix and the last 4 digits:
 * "+54 9 11 5832-4107" → "+54 9 11 •••• 4107".
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return phone;
  const last4 = digits.slice(-4);
  // Find where the 8th-from-last digit starts in the original string; keep everything before it.
  let seen = 0;
  let cut = phone.length;
  for (let i = phone.length - 1; i >= 0; i--) {
    if (/\d/.test(phone[i]!)) {
      seen++;
      if (seen === 8) {
        cut = i;
        break;
      }
    }
  }
  const prefix = phone.slice(0, cut).trim();
  return `${prefix ? `${prefix} ` : ""}•••• ${last4}`;
}

/** Short, human receipt reference from its UUID: "#A7F3-29". */
export function receiptRef(id: string): string {
  const h = id.replace(/-/g, "").toUpperCase();
  return `#${h.slice(0, 4)}-${h.slice(4, 6)}`;
}

/** Shortens hex for the technical-details drawer only: 0x7b2e…e4d9. */
export function shortHex(hex: string, head = 4, tail = 4): string {
  return hex.length <= head + tail + 3 ? hex : `${hex.slice(0, head + 2)}…${hex.slice(-tail)}`;
}

/** USD value (micro-USD) of one whole token, if derivable from a balance; used for display totals. */
export function usdMicrosPerUnit(amount: bigint, decimals: number, usdMicros: bigint): bigint | null {
  if (amount <= 0n) return null;
  return (usdMicros * 10n ** BigInt(decimals)) / amount;
}

/** Converts micro-USD into a display currency's atomic units (18 decimals) given micro-USD per unit. */
export function microsToCur(usdMicros: bigint, microsPerUnit: bigint): bigint {
  if (microsPerUnit <= 0n) return 0n;
  return (usdMicros * 10n ** 18n) / microsPerUnit;
}
