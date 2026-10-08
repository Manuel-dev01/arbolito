/**
 * Canonical JSON (RFC 8785 / JCS profile) for ProofBundles:
 * - object keys sorted by UTF-16 code units (JS default sort), no whitespace
 * - strings and numbers serialized as ECMAScript JSON.stringify does
 * - bigints are rejected: the bundle stores amounts as decimal strings
 * - undefined object members are dropped (as JSON.stringify does); undefined in arrays is rejected
 * Anyone can re-implement this in a few lines to recompute a bundle hash.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonical JSON: non-finite number");
      return JSON.stringify(value);
    case "bigint":
      throw new Error("canonical JSON: bigint must be converted to a decimal string first");
    case "object": {
      if (Array.isArray(value)) {
        return `[${value
          .map((v) => {
            if (v === undefined) throw new Error("canonical JSON: undefined in array");
            return canonicalize(v);
          })
          .join(",")}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
    }
    default:
      throw new Error(`canonical JSON: unsupported type ${typeof value}`);
  }
}

/** Deep-converts bigints to decimal strings so a value can be canonicalized. */
export function jsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}
