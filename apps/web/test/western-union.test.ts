import { describe, expect, it } from "vitest";
import { vsWesternUnion } from "../src/lib/miniapp/server/competitors";

const refs = [
  { name: "western_union", pair: "USD/BRL", rate: "4.8227", at: "2026-10-20T15:00:00.000Z" },
  { name: "western_union", pair: "USD/ARS", rate: "1618.75", at: "2026-10-20T15:00:00.000Z" },
];
const E18 = 10n ** 18n;

describe("vs Western Union", () => {
  it("dollars → reais: % and amount more than Western Union's rate", () => {
    // US$ 100 → R$ 506 with Arbolito; Western Union pays R$ 482.27.
    const v = vsWesternUnion("USDT", "wBRL", 100_000_000n, 506n * E18, refs)!;
    expect(v.pct).toBe(4.92);
    expect(v.deltaOut).toBe((506n * E18 - 48227n * E18 / 100n).toString());
    expect(v.rate).toBe("4.8227");
  });

  it("can be negative (pesos: about the same rate as Western Union before its fee)", () => {
    expect(vsWesternUnion("USDC", "wARS", 2_000_000n, 3_232n * E18, refs)!.pct).toBe(-0.16); // 1616 vs 1618.75, truncated to the basis point
  });

  it("only dollars → pesos/reais, and only with a reading", () => {
    expect(vsWesternUnion("wARS", "USDT", 1n, 1n, refs)).toBeNull();
    expect(vsWesternUnion("wBRL", "wARS", 1n, 1n, refs)).toBeNull();
    expect(vsWesternUnion("USDT", "wBRL", 100_000_000n, 506n * E18, [])).toBeNull();
  });
});
