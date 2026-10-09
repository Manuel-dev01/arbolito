/** Pretty JSON for files people read (the hash is always computed over canonical JSON, not this). */
export const jsonStringify = (v: unknown) =>
  `${JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2)}\n`;
