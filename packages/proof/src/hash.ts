import { keccak256, padHex, stringToBytes, type Hex } from "viem";
import { canonicalize } from "./canonical";
import type { ProofBundle } from "./schema";

/** bundleHash = keccak256(utf8(canonicalJson(bundle))). This is what goes onchain. */
export function bundleHash(bundle: ProofBundle): Hex {
  return keccak256(stringToBytes(canonicalize(bundle)));
}

/** Route ids are UUIDs; onchain they are the 16 UUID bytes left-padded to bytes32 (reversible). */
export function routeIdToBytes32(routeId: string): Hex {
  const hex = routeId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error(`routeId is not a UUID: ${routeId}`);
  return padHex(`0x${hex}`, { size: 32 });
}

export function bytes32ToRouteId(b: Hex): string {
  const hex = b.slice(-32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
