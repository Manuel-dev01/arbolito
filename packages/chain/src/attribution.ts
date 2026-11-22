import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";

/** Placeholder ERC-8021 code used only on anvil forks until the hackathon code is issued. */
export const FORK_ATTRIBUTION_CODE = "arbolito_fork";

/**
 * ATTRIBUTION_CODE may list several codes, comma-separated, primary first: one per hackathon
 * edition, so a transaction counts for the current edition and stays attributed to the earlier one
 * (since 2026-11-23, `celo_0acfe36b6ea3,celo_e054d92430a5`). ERC-8021 schema 0 carries a list.
 */
export function attributionCodeList(code: string | readonly string[]): string[] {
  const list = typeof code === "string" ? code.split(",") : [...code];
  return [...new Set(list.map((c) => c.trim()).filter(Boolean))];
}

/** The code that identifies Arbolito's own transactions: the first in the list. */
export function primaryAttributionCode(code: string | readonly string[]): string {
  const [first] = attributionCodeList(code);
  if (!first) throw new Error("empty attribution code");
  return first;
}

/** Appends the ERC-8021 attribution suffix (every code in the list) to calldata, or tags a bare transfer. */
export function withAttribution(data: Hex | undefined, code: string | readonly string[]): Hex {
  const codes = attributionCodeList(code);
  const suffix = toDataSuffix(codes.length === 1 ? codes[0]! : codes);
  return data && data !== "0x" ? concat([data, suffix]) : suffix;
}

/** Returns the attribution codes found at the end of calldata, or [] if untagged. */
export function attributionCodes(input: Hex): string[] {
  return fromDataSuffix(input)?.codes ?? [];
}

/** True when calldata carries the primary code of `code` (the current edition's). */
export function hasAttribution(input: Hex, code: string | readonly string[]): boolean {
  return attributionCodes(input).includes(primaryAttributionCode(code));
}
