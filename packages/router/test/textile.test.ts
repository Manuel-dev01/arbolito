import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKENS } from "@arbolito/config";
import { TextileApiError, TextileClient, TextileRfqAdapter, signTakerControl } from "../src";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const { wBRL, USDT } = TOKENS;

type Call = { url: string; init: RequestInit };
function mockFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

// Live /rfq/preview response for 200 wBRL → USDT (2026-10-09).
const PREVIEW = {
  data: {
    status: "preview",
    sellAmount: "200000000000000000000",
    buyAmount: "39685503",
    feeAmount: "19998000199980001",
    takerPays: "200000000000000000000",
    rateRay: "198447357751499999999007862",
    routing: { preferenceApplied: false, restrictionApplied: false, fallbackUsed: false, targetMakerWallets: [], preferredQuotesReceived: 0, openMarketQuotesReceived: 0 },
    availableSellAmount: "386773156841664266119402",
  },
};

describe("TakerControl", () => {
  it("signs the documented EIP-712 challenge, recoverable to the taker", async () => {
    const proof = await signTakerControl(account, 42220, 1_760_000_000_000);
    expect(proof.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    const signer = await recoverTypedDataAddress({
      domain: { name: "Textile Taker Control", version: "1", chainId: 42220 },
      types: {
        TakerControl: [
          { name: "taker", type: "address" },
          { name: "chainId", type: "uint256" },
          { name: "nonce", type: "bytes32" },
          { name: "issuedAt", type: "uint256" },
        ],
      },
      primaryType: "TakerControl",
      message: { taker: account.address, chainId: 42220n, nonce: proof.nonce, issuedAt: 1_760_000_000_000n },
      signature: proof.signature as Hex,
    });
    expect(signer).toBe(account.address);
  });
});

describe("TextileClient", () => {
  it("previews without credentials and parses the live shape", async () => {
    const calls: Call[] = [];
    const c = new TextileClient("https://api.textilecredit.com/v2", undefined, mockFetch(200, PREVIEW, calls));
    const p = await c.preview({ chainId: 42220, sellToken: wBRL.address, buyToken: USDT.address, sellAmount: 200n * 10n ** 18n });
    expect(p.buyAmount).toBe("39685503");
    expect(calls[0]!.url).toBe("https://api.textilecredit.com/v2/rfq/preview");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      chainId: 42220,
      sellToken: wBRL.address,
      buyToken: USDT.address,
      sellAmount: "200000000000000000000",
    });
  });

  it("adds takerProof on keyless firm requests, and not with a partner key", async () => {
    const firm = { data: { rfqId: "r1", claimToken: "c1", status: "no_quote", reason: "no_makers_online" } };
    const keyless: Call[] = [];
    await new TextileClient("https://x/v2", undefined, mockFetch(200, firm, keyless)).request({
      chainId: 42220, sellToken: wBRL.address, buyToken: USDT.address, sellAmount: 10n ** 18n, taker: account.address, account,
    });
    const body = JSON.parse(keyless[0]!.init.body as string);
    expect(body.taker).toBe(account.address);
    expect(body.takerProof).toMatchObject({ nonce: expect.stringMatching(/^0x/), issuedAt: expect.any(Number), signature: expect.stringMatching(/^0x/) });

    const keyed: Call[] = [];
    await new TextileClient("https://x/v2", "tx_live_test", mockFetch(200, firm, keyed)).request({
      chainId: 42220, sellToken: wBRL.address, buyToken: USDT.address, sellAmount: 10n ** 18n, taker: account.address,
    });
    expect(JSON.parse(keyed[0]!.init.body as string).takerProof).toBeUndefined();
    expect((keyed[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer tx_live_test");
  });

  it("sends the claim token on submit and status", async () => {
    const calls: Call[] = [];
    const c = new TextileClient("https://x/v2", undefined, mockFetch(200, { data: { rfqId: "r1", status: "submitted" } }, calls));
    await c.submit("r1", "claim-abc", `0x${"ab".repeat(32)}`);
    expect(calls[0]!.url).toBe("https://x/v2/rfq/r1/submit");
    expect((calls[0]!.init.headers as Record<string, string>)["x-rfq-claim"]).toBe("claim-abc");
  });

  it("raises a typed error on non-2xx", async () => {
    const c = new TextileClient("https://x/v2", undefined, mockFetch(429, { error: { code: "rate_limited" } }));
    await expect(c.preview({ chainId: 42220, sellToken: wBRL.address, buyToken: USDT.address, sellAmount: 1n })).rejects.toBeInstanceOf(TextileApiError);
  });
});

describe("TextileRfqAdapter", () => {
  const params = { tokenIn: wBRL.address, tokenOut: USDT.address, amountIn: 200n * 10n ** 18n, taker: account.address, blockNumber: 1n };

  it("maps a preview to an indicative quote", async () => {
    const q = await new TextileRfqAdapter(new TextileClient("https://x/v2", undefined, mockFetch(200, PREVIEW))).quote(params);
    expect(q).toMatchObject({ venue: "textile_rfq", amountOut: 39_685_503n, firm: false });
  });

  it("returns null when there is no corridor", async () => {
    const body = { error: { code: "invalid_request", details: { reason: "corridor_unavailable" } } };
    const q = await new TextileRfqAdapter(new TextileClient("https://x/v2", undefined, mockFetch(400, body))).quote(params);
    expect(q).toBeNull();
  });

  it("refuses a preview that only partially covers the size", async () => {
    const partial = { data: { ...PREVIEW.data, sellAmount: "100000000000000000000" } };
    const q = await new TextileRfqAdapter(new TextileClient("https://x/v2", undefined, mockFetch(200, partial))).quote(params);
    expect(q).toBeNull();
  });
});
