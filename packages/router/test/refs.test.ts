import { afterEach, describe, expect, it, vi } from "vitest";
import { fmtRate, interbankRefs } from "../src/refs";

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
