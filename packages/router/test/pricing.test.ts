import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { TOKENS } from "@arbolito/config";
import { usdMicros } from "../src/pricing";

/** A client whose QuoterV2 simulation always reverts, as for a token with no Uniswap pool. */
const noPool = { simulateContract: async () => Promise.reject(new Error("no pool")), getBlockNumber: async () => 1n } as unknown as PublicClient;

describe("usdMicros", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prices a wFIAT with no Uniswap pool (wCOP) from Textile's free preview into USDT", async () => {
    const amount = 6416n * 10n ** 18n;
    const fetchMock = vi.fn(async () => Response.json({ data: { status: "preview", sellAmount: amount.toString(), buyAmount: "1987800" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await usdMicros(noPool, TOKENS.wCOP.address, amount, 1n)).toBe(1_987_800n);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/rfq/preview");
  });

  it("refuses a partial preview: a thin book must not undervalue the amount", async () => {
    const amount = 100_000n * 10n ** 18n;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { status: "preview", sellAmount: (amount / 2n).toString(), buyAmount: "15000000" } })));
    await expect(usdMicros(noPool, TOKENS.wCOP.address, amount, 1n)).rejects.toThrow(/Cannot price wCOP/);
  });

  it("counts USD stables at face value without any call", async () => {
    expect(await usdMicros(noPool, TOKENS.USDT.address, 12_500_000n)).toBe(12_500_000n);
  });
});
