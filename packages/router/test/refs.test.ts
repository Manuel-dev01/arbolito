import { afterEach, describe, expect, it, vi } from "vitest";
import { MIN_POOL_USDT, fiatOf, fmtRate, interbankRefs, uniswapRefs } from "../src/refs";

describe("fmtRate", () => {
  it("keeps 8 significant digits as a plain decimal", () => {
    expect(fmtRate(1612.345678)).toBe("1612.3457");
    expect(fmtRate(0.000610995417)).toBe("0.00061099542");
  });

  it("never writes exponent notation (receipts parse rates as decimals)", () => {
    expect(fmtRate(3.402567868363881e26)).toBe("340256790000000000000000000");
    expect(fmtRate(1.2345678912e-9)).toBe("0.0000000012345679");
  });
});

describe("interbankRefs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads USD/COP from ER-API and USD/MXN from the ECB, labelled interbank (never official)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("er-api")) return Response.json({ result: "success", time_last_update_utc: "Sat, 01 Nov 2026 00:02:31 +0000", rates: { COP: 3189.4, MXN: 18.8 } });
        return Response.json({ date: "2026-10-30", rates: { MXN: 18.908 } });
      }),
    );
    const refs = await interbankRefs();
    expect(refs.map((r) => [r.name, r.pair, r.rate])).toEqual([
      ["interbank", "USD/COP", "3189.4"],
      ["interbank", "USD/MXN", "18.908"],
    ]);
    expect(refs.every((r) => r.name !== "official")).toBe(true);
  });

  it("reads USD/NGN from ER-API too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("er-api") ? Response.json({ result: "success", time_last_update_utc: "Sun, 22 Nov 2026 00:02:32 +0000", rates: { COP: 3700, NGN: 1376.736792 } }) : new Response("down", { status: 503 }))),
    );
    expect((await interbankRefs()).map((r) => [r.name, r.pair, r.rate])).toEqual([
      ["interbank", "USD/COP", "3700"],
      ["interbank", "USD/NGN", "1376.7368"],
    ]);
  });

  it("keeps the source that answered and fails only when none does", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("er-api") ? new Response("down", { status: 503 }) : Response.json({ date: "2026-10-30", rates: { MXN: 18.9 } }))),
    );
    expect((await interbankRefs()).map((r) => r.pair)).toEqual(["USD/MXN"]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(interbankRefs()).rejects.toThrow(/no interbank source/);
  });
});

describe("uniswapRefs", () => {
  const client = (usdt: (pool: string) => bigint) =>
    ({
      multicall: async ({ contracts }: { contracts: { functionName: string; args?: string[] }[] }) =>
        contracts.map((c) => ({
          status: "success",
          result: c.functionName === "slot0" ? [2n ** 96n, 0] : c.functionName === "liquidity" ? 912959230885651704n : usdt(c.args![0]!.toLowerCase()),
        })),
    }) as never;

  it("leaves out a pool with almost no dollars in it (wBRL held 17 USDT on 2026-11-23, stuck at R$ 5.3197)", async () => {
    const brl = "0x01c3cf91cdf7b34181c7ec8566c0236951fea40f";
    const all = await uniswapRefs(client(() => MIN_POOL_USDT), 1n);
    expect(all.map((r) => r.pair).sort()).toEqual(["USD/ARS", "USD/BRL"]);
    const deep = await uniswapRefs(client((p) => (p === brl ? 17_417_202n : 41_903_807_790n)), 1n);
    expect(deep.map((r) => r.pair)).toEqual(["USD/ARS"]);
  });
});

describe("fiatOf", () => {
  it("maps dollar tokens to USD and local stablecoins to their ISO code", () => {
    expect(["USDT", "USDC", "USAT"].map(fiatOf)).toEqual(["USD", "USD", "USD"]);
    expect(["wARS", "wBRL", "wCOP", "wMXN", "cNGN"].map(fiatOf)).toEqual(["ARS", "BRL", "COP", "MXN", "NGN"]);
    expect(fiatOf("CELO")).toBe("CELO");
  });
});
