import { parseDecimal, type Locale } from "../../lib/format";

/**
 * Reads what the person typed with the locale's separators ("1.500,5" in es/pt, "1,500.5" in en)
 * into atomic units. Client-safe: only lib/format. Anything unparseable reads as 0.
 */
export function parseTyped(raw: string, locale: Locale, decimals = 18): bigint {
  const plain = locale === "en-US" ? raw.replace(/,/g, "") : raw.replace(/\./g, "").replace(",", ".");
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(plain)) return 0n;
  try {
    return parseDecimal(plain.endsWith(".") ? plain.slice(0, -1) : plain, decimals);
  } catch {
    return 0n;
  }
}
