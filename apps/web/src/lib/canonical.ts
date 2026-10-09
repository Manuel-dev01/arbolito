import { keccak256, stringToBytes, type Hex } from "viem";

/**
 * Browser-side re-implementation of the ProofBundle canonical JSON (RFC 8785 / JCS profile used
 * by packages/proof): keys sorted by UTF-16 code units, no whitespace, ECMAScript number and string
 * serialization, undefined members dropped. Kept independent of packages/proof on purpose, so the
 * page shows that anyone can recompute the hash in a few lines; a unit test pins it to the
 * reference implementation.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new Error(`canonical JSON: unsupported type ${typeof value}`);
}

/** bundleHash = keccak256(utf8(canonical JSON)), exactly what ArbolitoReceipts stores. */
export function hashCanonical(canonical: string): Hex {
  return keccak256(stringToBytes(canonical));
}

/**
 * Re-canonicalizes arbitrary JSON text (e.g. pasted or edited in the page) and hashes it.
 * Returns an error string instead of throwing so the UI can show it.
 */
export function hashJsonText(text: string): { hash?: Hex; canonical?: string; error?: string } {
  try {
    const canonical = canonicalJson(JSON.parse(text));
    return { hash: hashCanonical(canonical), canonical };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Route ids are UUIDs; onchain they are the 16 UUID bytes left-padded to bytes32. */
export function routeIdToBytes32(routeId: string): Hex | undefined {
  const hex = routeId.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? (`0x${"0".repeat(32)}${hex}` as Hex) : undefined;
}
