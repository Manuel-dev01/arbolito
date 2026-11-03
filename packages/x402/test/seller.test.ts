import { describe, expect, it } from "vitest";
import { TOKENS } from "@arbolito/config";
import { amountFor, priceOptions, roundUpSig, sellerExtensions, sellSymbol, v1Refusal } from "../src/seller";

const PAY_TO = "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c";

describe("roundUpSig", () => {
  it("rounds up to two significant digits", () => {
    expect(roundUpSig(8_262n, 2)).toBe(8_300n);
    expect(roundUpSig(8_200n, 2)).toBe(8_200n);
    expect(roundUpSig(99n, 2)).toBe(99n);
    expect(roundUpSig(101n, 2)).toBe(110n);
  });
});

describe("amountFor", () => {
  it("charges dollar tokens the USD price as is (6 decimals)", () => {
    expect(amountFor("USDT", 10_000n)).toBe(10_000n);
    expect(amountFor("USAT", 5_000n)).toBe(5_000n);
  });

  it("converts wFIAT at the rate and rounds up to two significant figures (18 decimals)", () => {
    // US$ 0.01 × 1652.445 = 16.52 ARS → 17 ARS
    expect(amountFor("wARS", 10_000n, 1652.445)).toBe(17n * 10n ** 18n);
    // US$ 0.005 × 5.454 = 0.02727 BRL → 0.028 BRL
    expect(amountFor("wBRL", 5_000n, 5.454)).toBe(28n * 10n ** 15n);
  });

  it("holds the price across small rate moves", () => {
    expect(amountFor("wARS", 10_000n, 1640)).toBe(amountFor("wARS", 10_000n, 1655));
  });

  it("offers no wFIAT price without a rate", () => {
    expect(amountFor("wCOP", 10_000n)).toBeNull();
    expect(amountFor("wCOP", 10_000n, 0)).toBeNull();
    expect(amountFor("wCOP", 10_000n, Number.NaN)).toBeNull();
  });
});

describe("priceOptions", () => {
  const opts = priceOptions(10_000n, { wARS: 1652.4, wBRL: 5.45 }, PAY_TO);
  const price = (i: number) => opts[i]!.price as { asset: string; amount: string; extra: Record<string, unknown> };

  it("lists local stablecoins first, then dollars, skipping wFIAT without a rate", () => {
    expect(opts.map((o) => sellSymbol((o.price as { asset: string }).asset))).toEqual(["wARS", "wBRL", "USDT", "USDC", "USAT"]);
  });

  it("pays to our wallet on Celo mainnet, exact scheme", () => {
    for (const o of opts) {
      expect(o).toMatchObject({ scheme: "exact", network: "eip155:42220", payTo: PAY_TO });
    }
  });

  it("marks wFIAT as Permit2 with its onchain EIP-712 domain", () => {
    expect(price(0)).toEqual({ asset: TOKENS.wARS.address, amount: (17n * 10n ** 18n).toString(), extra: { name: "Peso Argentino", version: "1", assetTransferMethod: "permit2" } });
    expect(price(1).extra).toEqual({ name: "Real Brasileño", version: "1", assetTransferMethod: "permit2" });
  });

  it("leaves dollar tokens on EIP-3009 with their domains", () => {
    expect(price(2)).toEqual({ asset: TOKENS.USDT.address, amount: "10000", extra: { name: "Tether USD", version: "1" } });
    expect(price(3).extra).toEqual({ name: "USDC", version: "2" });
  });
});

describe("sellerExtensions", () => {
  it("declares our ERC-8021 code and EIP-2612 gas sponsoring", () => {
    const ext = sellerExtensions("celo_e054d92430a5") as Record<string, { info?: Record<string, unknown> }>;
    expect(ext["builder-code"]?.info).toMatchObject({ a: "celo_e054d92430a5" });
    expect(Object.keys(ext)).toContain("eip2612GasSponsoring");
  });
});

describe("v1Refusal", () => {
  it("is a 402 that names v2", async () => {
    const r = v1Refusal();
    expect(r.status).toBe(402);
    expect(((await r.json()) as { error: string }).error).toMatch(/PAYMENT-SIGNATURE/);
  });
});
