import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { MemoryLedger, USD } from "@arbolito/chain";
import { NotPaywalledError, PaymentRejectedError, PaymentUncertainError, PriceTooHighError, payRequest, quoteRequest } from "../src/client";
import { decodeSettlement, signExact, type Challenge } from "../src/v1";

const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const URL = "https://gateway.usebuy.ai/v1/browser/sessions";
/** buy's real 402 for a 2-minute browser (2026-10-20), USDT entry. */
const CHALLENGE: Challenge = {
  x402Version: 1,
  accepts: [
    {
      scheme: "exact",
      network: "celo",
      maxAmountRequired: "4212",
      resource: URL,
      payTo: "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B",
      maxTimeoutSeconds: 300,
      asset: USDT,
      extra: { name: "Tether USD", version: "1" },
    },
  ],
};
const account = privateKeyToAccount(generatePrivateKey());
const caps = { maxActionMicros: USD(5), maxDailyMicros: USD(25) };
const NOW = new Date("2026-10-20T15:00:00Z");

/** A fake gateway: 402 without X-PAYMENT, then `paid` for the paid retry. */
function gateway(paid: (payment: string) => Response) {
  const calls: { payment: string | null }[] = [];
  const f = async (_url: string, init?: RequestInit) => {
    const payment = (init?.headers as Record<string, string> | undefined)?.["X-PAYMENT"] ?? null;
    calls.push({ payment });
    return payment ? paid(payment) : new Response(JSON.stringify(CHALLENGE), { status: 402 });
  };
  return { f, calls };
}
const settlementHeader = (tx: string) => Buffer.from(JSON.stringify({ success: true, transaction: tx, network: "celo", payer: account.address })).toString("base64");

describe("x402 v1 exact", () => {
  it("signs a TransferWithAuthorization the token's domain recovers to the payer", async () => {
    const p = await signExact(account, CHALLENGE.accepts[0]!, { nowSecs: 1_000_000, nonce: `0x${"ab".repeat(32)}` });
    const a = p.payload.authorization;
    expect(a).toMatchObject({ from: account.address, to: "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B", value: "4212", validAfter: "999940", validBefore: "1000300" });
    const signer = await recoverTypedDataAddress({
      domain: { name: "Tether USD", version: "1", chainId: 42220, verifyingContract: USDT },
      types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
      primaryType: "TransferWithAuthorization",
      message: { ...a, value: 4212n, validAfter: 999940n, validBefore: 1000300n },
      signature: p.payload.signature,
    });
    expect(signer).toBe(account.address);
  });

  it("quotes from the free 402, and treats any other answer as an error", async () => {
    const { f } = gateway(() => new Response("{}"));
    const q = await quoteRequest({ url: URL, body: { durationMinutes: 2 } }, USDT, f);
    expect(q.amount).toBe(4212n);
    await expect(quoteRequest({ url: URL }, USDT, async () => new Response("{}", { status: 200 }))).rejects.toBeInstanceOf(NotPaywalledError);
  });

  it("pays once, records the settlement tx in the ledger", async () => {
    const ledger = new MemoryLedger();
    const { f, calls } = gateway(() => new Response(JSON.stringify({ sessionId: "s1" }), { status: 200, headers: { "x-payment-response": settlementHeader("0xabc") } }));
    const q = await quoteRequest({ url: URL, body: { durationMinutes: 2 } }, USDT, f);
    const paid = await payRequest({ url: URL, body: { durationMinutes: 2 } }, { account, quote: q, maxAmount: 10_000n, ledger, caps, purpose: "buy browser 2m", now: () => NOW, fetch: f });
    expect(paid).toMatchObject({ status: 200, amount: 4212n, body: { sessionId: "s1" }, settlement: { transaction: "0xabc" } });
    expect(calls.filter((c) => c.payment)).toHaveLength(1);
    expect(await ledger.spent("2026-10-20")).toBe(4212n);
    const sent = JSON.parse(Buffer.from(calls[1]!.payment!, "base64").toString());
    expect(sent).toMatchObject({ x402Version: 1, scheme: "exact", network: "celo", payload: { authorization: { value: "4212" } } });
  });

  it("refuses a price above our limit before signing; a refused payment releases the reservation", async () => {
    const ledger = new MemoryLedger();
    const { f } = gateway(() => new Response("bad signature", { status: 402 }));
    const q = await quoteRequest({ url: URL }, USDT, f);
    await expect(payRequest({ url: URL }, { account, quote: q, maxAmount: 4_000n, ledger, caps, purpose: "x", now: () => NOW, fetch: f })).rejects.toBeInstanceOf(PriceTooHighError);
    await expect(payRequest({ url: URL }, { account, quote: q, maxAmount: 10_000n, ledger, caps, purpose: "x", now: () => NOW, fetch: f })).rejects.toBeInstanceOf(PaymentRejectedError);
    expect(await ledger.spent("2026-10-20")).toBe(0n);
  });

  it("an error or no answer after paying is uncertain: the reservation stays (never retried)", async () => {
    const ledger = new MemoryLedger();
    const fail = gateway(() => new Response("boom", { status: 500, headers: { "x-payment-response": settlementHeader("0xdef") } }));
    const q = await quoteRequest({ url: URL }, USDT, fail.f);
    await expect(payRequest({ url: URL }, { account, quote: q, maxAmount: 10_000n, ledger, caps, purpose: "x", now: () => NOW, fetch: fail.f })).rejects.toThrow(/settled in 0xdef/);
    const dropped = async (_u: string, init?: RequestInit) => {
      if ((init?.headers as Record<string, string>)["X-PAYMENT"]) throw new Error("socket hang up");
      return new Response(JSON.stringify(CHALLENGE), { status: 402 });
    };
    await expect(payRequest({ url: URL }, { account, quote: q, maxAmount: 10_000n, ledger, caps, purpose: "x", now: () => NOW, fetch: dropped })).rejects.toBeInstanceOf(PaymentUncertainError);
    expect(await ledger.spent("2026-10-20")).toBe(8424n);
    expect(decodeSettlement("not base64 json")).toBeNull();
  });
});
