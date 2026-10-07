import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema, findRepoRoot, tokenBySymbol, TOKENS, POOLS } from "../src";

describe("env schema", () => {
  it("has exactly the keys listed in .env.example", () => {
    const example = readFileSync(join(findRepoRoot(), ".env.example"), "utf8");
    const exampleKeys = example
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split("=")[0]!.trim())
      .sort();
    expect(Object.keys(envSchema.shape).sort()).toEqual(exampleKeys);
  });

  it("parses .env.example defaults and treats empty values as unset", () => {
    const env = envSchema.parse({ OPS_PRIVATE_KEY: "", TEXTILE_RFQ_ENABLED: "false" });
    expect(env.OPS_PRIVATE_KEY).toBeUndefined();
    expect(env.TEXTILE_RFQ_ENABLED).toBe(false);
    expect(env.BUILD_MAX_ACTION_USD).toBe(5);
    expect(env.BUILD_MAX_DAILY_USD).toBe(25);
  });

  it("rejects malformed attribution codes and keys", () => {
    expect(() => envSchema.parse({ ATTRIBUTION_CODE: "Celo XYZ" })).toThrow();
    expect(() => envSchema.parse({ OPS_PRIVATE_KEY: "0x1234" })).toThrow();
  });
});

describe("token config", () => {
  it("resolves symbols case-insensitively, including the ₮ spelling", () => {
    expect(tokenBySymbol("wbrl").address).toBe(TOKENS.wBRL.address);
    expect(tokenBySymbol("USA₮").symbol).toBe("USAT");
    expect(() => tokenBySymbol("DOGE")).toThrow(/Unknown token/);
  });

  it("uses 18 decimals for wFIAT and 6 for USD stables", () => {
    for (const t of Object.values(TOKENS)) {
      if (t.kind === "wfiat") expect(t.decimals).toBe(18);
      if (t.kind === "usd") {
        expect(t.decimals).toBe(6);
        expect(t.feeCurrencyAdapter).toBeDefined();
      }
    }
  });

  it("only references configured tokens in pools", () => {
    for (const p of POOLS) {
      expect(TOKENS[p.token0]).toBeDefined();
      expect(TOKENS[p.token1]).toBeDefined();
    }
  });
});
