import { formatUnits, parseUnits, type Address } from "viem";
import { tokenByAddress } from "@arbolito/config";

/** UI-edge formatting only. Everything upstream stays bigint. */
export function fmtAmount(token: Address, amount: bigint, maxFraction = 4): string {
  const t = tokenByAddress(token);
  const [int, frac = ""] = formatUnits(amount, t.decimals).split(".");
  const trimmed = frac.slice(0, maxFraction).replace(/0+$/, "");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}${trimmed ? `.${trimmed}` : ""} ${t.symbol}`;
}

export function toAtomic(token: Address, human: string): bigint {
  return parseUnits(human, tokenByAddress(token).decimals);
}

/** Effective rate as tokenOut per 1 tokenIn, for display. */
export function effectiveRate(tokenIn: Address, amountIn: bigint, tokenOut: Address, amountOut: bigint): number {
  const a = Number(formatUnits(amountIn, tokenByAddress(tokenIn).decimals));
  const b = Number(formatUnits(amountOut, tokenByAddress(tokenOut).decimals));
  return a === 0 ? 0 : b / a;
}
