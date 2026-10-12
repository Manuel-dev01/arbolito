/**
 * Display formatting at the UI edge. Amounts stay bigint atomic units until here; display
 * always rounds DOWN, so a "guaranteed minimum" is never overstated.
 */
import { TOKENS } from "@arbolito/config";
import type { Sym } from "./contract";
import type { Lang } from "./i18n";

export const decimalsOf = (sym: Sym): number => TOKENS[sym].decimals;

/** "ARS 160.800,00", "R$ 200,00", "US$ 100,00": currency the user thinks in, not the token. */
const PREFIX: Record<Sym, string> = { wARS: "ARS", wBRL: "R$", USDT: "US$", USAT: "US$", USDC: "US$" };

const seps = (lang: Lang) => (lang === "en" ? { group: ",", dec: "." } : { group: ".", dec: "," });

/** Formats a non-negative or negative atomic amount with `frac` fraction digits (floor toward zero). */
export function formatAtomic(atomic: bigint, decimals: number, frac: number, lang: Lang): string {
  const neg = atomic < 0n;
  const abs = neg ? -atomic : atomic;
  const scaled = decimals >= frac ? abs / 10n ** BigInt(decimals - frac) : abs * 10n ** BigInt(frac - decimals);
  const unit = 10n ** BigInt(frac);
  const int = (scaled / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, seps(lang).group);
  const fracStr = frac > 0 ? seps(lang).dec + (scaled % unit).toString().padStart(frac, "0") : "";
  return `${neg ? "-" : ""}${int}${fracStr}`;
}

export function money(sym: Sym, atomic: bigint | string, lang: Lang, frac = 2): string {
  return `${PREFIX[sym]} ${formatAtomic(BigInt(atomic), decimalsOf(sym), frac, lang)}`;
}

/** A decimal string ("1608.1234") as a bigint scaled by 1e18; extra digits are truncated. */
function decimalToScaled(s: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) return 0n;
  const v = BigInt(m[2]!) * 10n ** 18n + BigInt((m[3] ?? "").slice(0, 18).padEnd(18, "0"));
  return m[1] ? -v : v;
}

/** A rate for display: no decimals from 1,000 up, 2 from 1, up to 6 (trimmed) below 1. */
export function formatRate(rate: string, lang: Lang): string {
  const v = decimalToScaled(rate);
  const abs = v < 0n ? -v : v;
  if (abs >= 1000n * 10n ** 18n) return formatAtomic(v, 18, 0, lang);
  if (abs >= 10n ** 18n) return formatAtomic(v, 18, 2, lang);
  const s = formatAtomic(v, 18, 6, lang);
  return s.replace(/0+$/, "").replace(/[.,]$/, "");
}

/** "1 US$ = ARS 1.608" */
export function rateLine(from: Sym, to: Sym, rate: string, lang: Lang): string {
  return `1 ${PREFIX[from]} = ${PREFIX[to]} ${formatRate(rate, lang)}`;
}

/** "+4,08%" (pct is in percent units: 4.08 means +4.08%). */
export function formatPct(pct: number, lang: Lang): string {
  const s = Math.abs(pct).toFixed(2);
  return `${pct >= 0 ? "+" : "-"}${lang === "en" ? s : s.replace(".", ",")}%`;
}

/** Plain-language currency names for "reales → pesos". */
export function currencyName(sym: Sym, lang: Lang): string {
  if (sym === "wARS") return "pesos";
  if (sym === "wBRL") return lang === "es" ? "reales" : "reais";
  return lang === "en" ? "dollars" : "dólares";
}

/** "0x7e03…6c3c": enough to recognise, never the full address in chat. */
export function maskWallet(address: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? `${address.slice(0, 6)}…${address.slice(-4)}` : "…";
}
