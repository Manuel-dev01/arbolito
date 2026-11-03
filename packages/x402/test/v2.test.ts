import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { MemoryLedger, USD } from "@arbolito/chain";
import { TOKENS } from "@arbolito/config";
import { NotPaywalledError, PriceTooHighError } from "../src/client";
import { priceOptions } from "../src/seller";
import { payV2, quoteV2, signV2 } from "../src/v2";

// Anvil dev key #1: signs in memory only, never funded or broadcast.
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const PAY_TO = "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c";
const caps = { maxActionMicros: USD(5), maxDailyMicros: USD(25) };
const URL = "https://seller.example/api/x402/rates";

/** A v2 402 as @x402/core encodes it: PAYMENT-REQUIRED header, base64 JSON. */
function challenge(): Response {
  const accepts = priceOptions(5_000n, { wBRL: 5.45 }, PAY_TO).map((o) => {
    const p = o.price as { asset: string; amount: string; extra: Record<string, unknown> };
    return { scheme: "exact", network: o.network, asset: p.asset, amount: p.amount, payTo: PAY_TO, maxTimeoutSeconds: 120, extra: p.extra };
  });
  const pr = { x402Version: 2, error: "Payment required", resource: { url: URL, description: "rates", mimeType: "application/json" }, accepts };
  return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(pr)).toString("base64") } });
}

describe("quoteV2", () => {
  it("reads the requirement for the asset from the 402", async () => {
    const q = await quoteV2(URL, TOKENS.wBRL.address, async () => challenge());
    expect(q.amount).toBe(28n * 10n ** 15n);
    expect(q.requirement.extra).toMatchObject({ assetTransferMethod: "permit2" });
  });

  it("treats a non-402 answer to an unpaid request as an error", async () => {
    await expect(quoteV2(URL, TOKENS.USDT.address, async () => new Response("{}", { status: 200 }))).rejects.toBeInstanceOf(NotPaywalledError);
  });
});

describe("signV2", () => {
  it("signs an EIP-3009 authorization for exactly the quoted USDT amount to payTo", async () => {
    const quote = await quoteV2(URL, TOKENS.USDT.address, async () => challenge());
    const p = await signV2({ account, quote, builderCode: "celo_e054d92430a5" });
    const auth = (p.payload as { authorization: { from: string; to: string; value: string } }).authorization;
    expect(auth).toMatchObject({ from: account.address, to: PAY_TO, value: "5000" });
    expect(p.accepted).toMatchObject({ asset: TOKENS.USDT.address, amount: "5000" });
    expect((p.extensions?.["builder-code"] as { info: { s?: string[] } }).info.s).toContain("celo_e054d92430a5");
  });
});

describe("payV2", () => {
  it("refuses a price above our limit before signing or reserving", async () => {
    const quote = await quoteV2(URL, TOKENS.USDT.address, async () => challenge());
    const ledger = new MemoryLedger();
    let sent = false;
    await expect(
      payV2(URL, { account, quote, maxAmount: 1_000n, usdMicros: 5_000n, ledger, caps, purpose: "test", fetch: async () => ((sent = true), new Response()) }),
    ).rejects.toBeInstanceOf(PriceTooHighError);
    expect(sent).toBe(false);
    expect(await ledger.spent(new Date().toISOString().slice(0, 10))).toBe(0n);
  });

  it("sends once and releases the reservation when the seller refuses the payment", async () => {
    const quote = await quoteV2(URL, TOKENS.USDT.address, async () => challenge());
    const ledger = new MemoryLedger();
    let calls = 0;
    await expect(
      payV2(URL, { account, quote, maxAmount: 10_000n, usdMicros: 5_000n, ledger, caps, purpose: "test", fetch: async () => (calls++, challenge()) }),
    ).rejects.toThrow(/payment refused/);
    expect(calls).toBe(1);
    expect(await ledger.spent(new Date().toISOString().slice(0, 10))).toBe(0n);
  });

  it("sends the v1 envelope in both headers for sellers that still read v1 payments", async () => {
    const quote = await quoteV2(URL, TOKENS.USDT.address, async () => challenge());
    let seen: Record<string, string> = {};
    await payV2(URL, {
      account, quote, maxAmount: 10_000n, usdMicros: 5_000n, ledger: new MemoryLedger(), caps, purpose: "test", legacyEnvelope: true,
      fetch: async (_u, init) => ((seen = init?.headers as Record<string, string>), Response.json({ ok: true })),
    });
    const v1 = JSON.parse(Buffer.from(seen["X-PAYMENT"]!, "base64").toString("utf8"));
    expect(seen["PAYMENT-SIGNATURE"]).toBe(seen["X-PAYMENT"]);
    expect(v1).toMatchObject({ x402Version: 1, scheme: "exact", network: "eip155:42220" });
    expect(v1.payload.authorization).toMatchObject({ from: account.address, value: "5000" });
    expect(v1).not.toHaveProperty("accepted");
  });
});
