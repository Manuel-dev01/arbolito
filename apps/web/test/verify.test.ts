import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toEventSelector, toFunctionSelector } from "viem";
import { bundleHash, canonicalize, proofBundleSchema, receiptsAbi, routeIdToBytes32 as proofRouteId } from "@arbolito/proof";
import { canonicalJson, hashCanonical, hashJsonText, routeIdToBytes32 } from "../src/lib/canonical";
import { receiptsReadAbi } from "../src/lib/receipts-abi";

const dir = fileURLToPath(new URL("../../../docs/receipts/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

/** Hashes verified against ArbolitoReceipts on Celo mainnet (pnpm verify:receipt, 2026-10-09). */
const ANCHORED: Record<string, string> = {
  "bf28b8ab-31a9-4679-8028-bcb471f7d980.json": "0x671c9bc9fb3c6541bc178db1a8e1ce8c71e34d6acc9d9986153cec097b3f2086",
  "b334459a-884b-4bed-b4a3-d56710ae74ee.json": "0x9ca20b5182bb51b3749d30939de59d2e320019091e3be3c62c5f0d4703ae272d",
  "b334459a-884b-4bed-b4a3-d56710ae74ee.superseded.json": "0xe6acaae03571e60f135bbbcdeb9b09675a79d9d87ea7ca3dc02a001464fe8871",
};

describe("browser canonical JSON + hash", () => {
  it.each(files)("matches packages/proof for %s", (file) => {
    const raw: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const bundle = proofBundleSchema.parse(raw);
    expect(canonicalJson(bundle)).toBe(canonicalize(bundle));
    // Hashing the raw file JSON (as the page does) gives the same value as the parsed bundle.
    expect(hashCanonical(canonicalJson(raw))).toBe(bundleHash(bundle));
  });

  it.each(Object.entries(ANCHORED))("recomputes the anchored hash of %s", (file, hash) => {
    const text = readFileSync(join(dir, file), "utf8");
    expect(hashJsonText(text).hash).toBe(hash);
    // Pretty-printed or canonical text hash the same; a one-character edit does not.
    expect(hashJsonText(JSON.stringify(JSON.parse(text))).hash).toBe(hash);
    expect(hashJsonText(text.replace('"chainId": 42220', '"chainId": 42221')).hash).not.toBe(hash);
  });

  it("sorts keys by UTF-16 code units and drops undefined members", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"], B: undefined, é: 0.5, Z: -0 })).toBe('{"Z":0,"a":[true,null,"x"],"b":1,"é":0.5}');
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalize({ b: 1, a: 2 }));
  });

  it("reports invalid JSON instead of throwing", () => {
    expect(hashJsonText("{nope").error).toBeTruthy();
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
  });

  it("encodes route ids like packages/proof", () => {
    const id = "bf28b8ab-31a9-4679-8028-bcb471f7d980";
    expect(routeIdToBytes32(id)).toBe(proofRouteId(id));
    expect(routeIdToBytes32("not-a-uuid")).toBeUndefined();
  });
});

describe("client ABI slice", () => {
  it("matches the contract ABI in packages/proof", () => {
    const sig = (x: (typeof receiptsAbi)[number] | (typeof receiptsReadAbi)[number]) =>
      x.type === "event" ? toEventSelector(x) : x.type === "function" ? toFunctionSelector(x) : x.type;
    const full = new Set(receiptsAbi.map(sig));
    for (const item of receiptsReadAbi) expect(full.has(sig(item))).toBe(true);
  });
});
