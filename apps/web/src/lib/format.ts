/**
 * UI-edge formatting. Everything upstream is bigint in atomic units; this is the only place
 * amounts become strings. Pure and client-safe (no Node or workspace imports).
 */

export type Locale = "es-AR" | "pt-BR" | "en-US";

/** Fixed-point scale used for rates (18 decimals). */
export const RATE_DECIMALS = 18;
export const RATE_ONE = 10n ** 18n;

const abs = (x: bigint) => (x < 0n ? -x : x);

/** Parses a non-negative decimal string ("1542.7", "5.0593844") into a bigint scaled by 10^scale (truncates extra digits). */
export function parseDecimal(value: string, scale: number = RATE_DECIMALS): bigint {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error(`not a decimal: ${value}`);
  const int = BigInt(m[2] || "0");
  const frac = (m[3] ?? "").slice(0, scale).padEnd(scale, "0");
  const v = int * 10n ** BigInt(scale) + BigInt(frac || "0");
  return m[1] === "-" ? -v : v;
}

/** Rounds an atomic amount with `decimals` to `dp` decimal places (half away from zero). Returns the value scaled by 10^dp. */
export function roundToDp(amount: bigint, decimals: number, dp: number): bigint {
  if (dp >= decimals) return amount * 10n ** BigInt(dp - decimals);
  const div = 10n ** BigInt(decimals - dp);
  const q = abs(amount) / div;
  const r = abs(amount) % div;
  const rounded = r * 2n >= div ? q + 1n : q;
  return amount < 0n ? -rounded : rounded;
}

const separatorCache = new Map<string, string>();
function decimalSeparator(locale: Locale): string {
  let s = separatorCache.get(locale);
  if (!s) {
    s = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
    separatorCache.set(locale, s);
  }
  return s;
}

export interface FixedOptions {
  /** Max fraction digits (rounded). */
  dp: number;
  /** Min fraction digits kept after trimming trailing zeros (default: dp, i.e. no trimming). */
  minDp?: number;
  /** Prefix positive numbers with "+". */
  signed?: boolean;
}

/** Formats an atomic amount (`decimals`) for a locale: grouping and decimal separator, exact bigint rounding. */
export function formatFixed(amount: bigint, decimals: number, locale: Locale, o: FixedOptions): string {
  const scaled = roundToDp(amount, decimals, o.dp);
  const neg = scaled < 0n;
  const a = abs(scaled);
  const unit = 10n ** BigInt(o.dp);
  const int = a / unit;
  let frac = o.dp > 0 ? (a % unit).toString().padStart(o.dp, "0") : "";
  const minDp = o.minDp ?? o.dp;
  while (frac.length > minDp && frac.endsWith("0")) frac = frac.slice(0, -1);
  const grouped = new Intl.NumberFormat(locale, { useGrouping: true }).format(int);
  const body = frac ? `${grouped}${decimalSeparator(locale)}${frac}` : grouped;
  const isZero = scaled === 0n;
  return `${neg ? "-" : o.signed && !isZero ? "+" : ""}${body}`;
}

/** Fiat behind a token symbol: USD stables → USD, wARS → ARS, BRLm → BRL. */
export function fiatOfSymbol(symbol: string): string {
  if (["USAT", "USDT", "USDC", "USDm", "USD₮", "USA₮"].includes(symbol)) return "USD";
  if (/^w[A-Z]{3}$/.test(symbol)) return symbol.slice(1);
  if (/^[A-Z]{3}m$/.test(symbol)) return symbol.slice(0, 3);
  return symbol;
}

const FIAT_PREFIX: Record<string, string> = { USD: "US$", BRL: "R$", ARS: "ARS", COP: "COP", MXN: "MX$", CLP: "CLP", PEN: "S/", NGN: "₦" };

export function fiatPrefix(fiat: string): string {
  return FIAT_PREFIX[fiat] ?? fiat;
}

/**
 * Money in the user's currency: "R$ 10", "ARS 3.177,41", "US$ 2,50".
 * Whole amounts drop the ".00"; anything else shows two decimals.
 */
export function formatMoney(amount: bigint, decimals: number, fiat: string, locale: Locale, o: { signed?: boolean } = {}): string {
  const cents = roundToDp(amount, decimals, 2);
  const whole = cents % 100n === 0n;
  const n = formatFixed(amount, decimals, locale, { dp: 2, minDp: whole ? 0 : 2, signed: o.signed });
  const sign = n.startsWith("-") || n.startsWith("+") ? n[0] : "";
  return `${sign}${fiatPrefix(fiat)} ${sign ? n.slice(1) : n}`;
}

/** Token amount with its symbol, up to `dp` decimals with trailing zeros trimmed: "3.177,4119 wARS". */
export function formatToken(amount: bigint, decimals: number, symbol: string, locale: Locale, dp = 4): string {
  return `${formatFixed(amount, decimals, locale, { dp, minDp: 0 })} ${symbol}`;
}

/** tokenOut per 1 tokenIn, scaled by 1e18, from atomic amounts. */
export function rateOf(amountIn: bigint, decimalsIn: number, amountOut: bigint, decimalsOut: number): bigint {
  if (amountIn === 0n) return 0n;
  return (amountOut * 10n ** BigInt(decimalsIn) * RATE_ONE) / (amountIn * 10n ** BigInt(decimalsOut));
}

/** Applies a 1e18-scaled rate to an atomic amount, converting between token decimals. */
export function applyRate(amountIn: bigint, decimalsIn: number, rate: bigint, decimalsOut: number): bigint {
  return (amountIn * rate * 10n ** BigInt(decimalsOut)) / (RATE_ONE * 10n ** BigInt(decimalsIn));
}

/** A 1e18-scaled rate with sensible precision: ≥100 → 2 dp, ≥1 → 4 dp, else 6 dp. */
export function formatRate(rate: bigint, locale: Locale): string {
  const dp = rate >= 100n * RATE_ONE ? 2 : rate >= RATE_ONE ? 4 : 6;
  return formatFixed(rate, RATE_DECIMALS, locale, { dp });
}

/** Basis points as a signed percentage: 524 → "+5,24 %" (es) / "+5.24%" (en). */
export function formatBps(bps: number | bigint, locale: Locale): string {
  const b = typeof bps === "bigint" ? bps : BigInt(Math.round(bps));
  const pct = formatFixed(b, 2, locale, { dp: 2, signed: true });
  return locale === "en-US" ? `${pct}%` : `${pct} %`;
}

/** Shortens a hash or address for display: 0x43ab6cca…e743. */
export function shortHex(hex: string, head = 8, tail = 4): string {
  return hex.length <= head + tail + 1 ? hex : `${hex.slice(0, head + 2)}…${hex.slice(-tail)}`;
}

/** Median of a list of bigints (mean of the two middle values for even lengths, rounded toward zero). */
export function medianBigint(values: bigint[]): bigint | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2n;
}
