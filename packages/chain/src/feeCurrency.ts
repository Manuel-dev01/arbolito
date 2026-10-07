import type { Address } from "viem";
import { tokenBySymbol } from "@arbolito/config";

/**
 * Value for a Celo tx's `feeCurrency` field.
 * - CELO: undefined (native gas)
 * - 6-decimal stables (USDT, USDC, USA₮): the fee **adapter**, never the token
 * - 18-decimal allowlisted tokens (Mento stables): the token itself
 * - anything else (wFIAT, cNGN): throws; they are not on the fee-currency allowlist
 */
export function feeCurrencyFor(symbol: string): Address | undefined {
  const t = tokenBySymbol(symbol);
  if (t.kind === "native") return undefined;
  if (!t.feeCurrency) throw new Error(`${t.symbol} is not a Celo fee currency; pay gas in CELO, USDT, USDC or USA₮`);
  if (t.decimals !== 18) {
    if (!t.feeCurrencyAdapter) throw new Error(`${t.symbol} needs a fee adapter but none is configured`);
    return t.feeCurrencyAdapter;
  }
  return t.address;
}
