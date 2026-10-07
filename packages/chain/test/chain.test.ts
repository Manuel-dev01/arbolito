import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { PublicClient, WalletClient } from "viem";
import { CONTRACTS, TOKENS, loadEnv } from "@arbolito/config";
import {
  CapExceededError,
  FORK_ATTRIBUTION_CODE,
  LiveGuardError,
  MemoryLedger,
  USD,
  attributionCodes,
  checkCaps,
  feeCurrencyFor,
  sendGuarded,
  utcDay,
  withAttribution,
} from "../src";

const caps = { maxActionMicros: USD(5), maxDailyMicros: USD(25) };

describe("checkCaps", () => {
  it("allows an action at exactly the per-action cap", () => {
    expect(checkCaps(USD(5), 0n, caps)).toBe(USD(5));
  });
  it("rejects an action over the per-action cap", () => {
    expect(() => checkCaps(USD(5.01), 0n, caps)).toThrow(CapExceededError);
  });
  it("rejects an action that would cross the daily cap", () => {
    expect(() => checkCaps(USD(2), USD(24), caps)).toThrow(/daily cap/);
    expect(checkCaps(USD(1), USD(24), caps)).toBe(USD(25));
  });
  it("resets at the UTC day boundary", () => {
    const ledger = new MemoryLedger();
    const late = new Date("2026-10-07T23:59:00Z");
    const early = new Date("2026-10-08T00:01:00Z");
    ledger.reserve(utcDay(late), { id: "a", at: late.toISOString(), purpose: "t", usdMicros: USD(25).toString() });
    expect(() => checkCaps(USD(1), ledger.spent(utcDay(late)), caps)).toThrow(CapExceededError);
    expect(checkCaps(USD(1), ledger.spent(utcDay(early)), caps)).toBe(USD(1));
  });
  it("does not count released reservations", () => {
    const ledger = new MemoryLedger();
    ledger.reserve("2026-10-07", { id: "a", at: "", purpose: "t", usdMicros: USD(20).toString() });
    ledger.update("2026-10-07", "a", { status: "released" });
    expect(ledger.spent("2026-10-07")).toBe(0n);
  });
});

describe("attribution", () => {
  it("appends a decodable ERC-8021 suffix to calldata", () => {
    const data = withAttribution("0xa9059cbb", "arbolito_fork");
    expect(data.startsWith("0xa9059cbb")).toBe(true);
    expect(attributionCodes(data)).toEqual(["arbolito_fork"]);
  });
  it("tags a bare transfer", () => {
    expect(attributionCodes(withAttribution(undefined, FORK_ATTRIBUTION_CODE))).toEqual([FORK_ATTRIBUTION_CODE]);
  });
  it("rejects invalid codes", () => {
    expect(() => withAttribution("0x", "Bad Code")).toThrow();
  });
});

describe("feeCurrencyFor", () => {
  it("uses the adapter for 6-decimal stables", () => {
    expect(feeCurrencyFor("USAT")).toBe(CONTRACTS.feeAdapters.USAT);
    expect(feeCurrencyFor("usdt")).toBe(CONTRACTS.feeAdapters.USDT);
    expect(feeCurrencyFor("USDC")).toBe(CONTRACTS.feeAdapters.USDC);
  });
  it("uses the token for 18-decimal Mento stables and nothing for CELO", () => {
    expect(feeCurrencyFor("USDm")).toBe(TOKENS.USDm.address);
    expect(feeCurrencyFor("CELO")).toBeUndefined();
  });
  it("refuses wFIAT", () => {
    expect(() => feeCurrencyFor("wARS")).toThrow(/not a Celo fee currency/);
  });
});

describe("sendGuarded guards", () => {
  // Throwaway key (anvil default #0), never funded on mainnet.
  const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const fakePublic = (clientVersion: string, chainId = 42220) =>
    ({
      getChainId: async () => chainId,
      request: async () => clientVersion,
      call: async () => {
        throw new Error("should not reach simulation");
      },
    }) as unknown as PublicClient;
  const wallet = { account, chain: undefined } as unknown as WalletClient;
  const base = { walletClient: wallet, to: TOKENS.USDT.address, usdMicros: 0n, purpose: "test" } as const;

  it("refuses a mainnet send without --live", async () => {
    await expect(sendGuarded({ ...base, mode: "live", publicClient: fakePublic("Geth/v1") })).rejects.toThrow(LiveGuardError);
  });
  it("refuses fork mode against a non-anvil node", async () => {
    await expect(sendGuarded({ ...base, mode: "fork", publicClient: fakePublic("Geth/v1") })).rejects.toThrow(/not anvil/);
  });
  it("refuses live mode against anvil", async () => {
    await expect(
      sendGuarded({ ...base, mode: "live", live: true, attributionCode: "x", publicClient: fakePublic("anvil/v1.7.1") }),
    ).rejects.toThrow(/use mode=fork/);
  });
  it.skipIf(!!loadEnv().ATTRIBUTION_CODE)("refuses a mainnet send without an attribution code", async () => {
    await expect(sendGuarded({ ...base, mode: "live", live: true, publicClient: fakePublic("Geth/v1") })).rejects.toThrow(
      /ATTRIBUTION_CODE/,
    );
  });
  it("enforces caps before simulating or signing", async () => {
    await expect(
      sendGuarded({ ...base, mode: "fork", usdMicros: USD(6), ledger: new MemoryLedger(), publicClient: fakePublic("anvil/v1") }),
    ).rejects.toThrow(CapExceededError);
  });
});
