import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";

/** Placeholder ERC-8021 code used only on anvil forks until the hackathon code is issued. */
export const FORK_ATTRIBUTION_CODE = "arbolito_fork";

/** Appends the ERC-8021 attribution suffix to calldata (or tags a bare transfer). */
export function withAttribution(data: Hex | undefined, code: string): Hex {
  const suffix = toDataSuffix(code);
  return data && data !== "0x" ? concat([data, suffix]) : suffix;
}

/** Returns the attribution codes found at the end of calldata, or [] if untagged. */
export function attributionCodes(input: Hex): string[] {
  return fromDataSuffix(input)?.codes ?? [];
}
