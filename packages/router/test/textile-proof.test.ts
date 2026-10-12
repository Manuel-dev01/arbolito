import { describe, expect, it } from "vitest";
import { recoverMessageAddress, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKENS } from "@arbolito/config";
import { TextileClient, takerControlMessage, takerControlNonce, takerControlTypedData } from "../src";

// Anvil dev key #1, used only to sign in memory (never funded, never broadcast).
const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const { wBRL, USDT } = TOKENS;

type Call = { url: string; init: RequestInit };
function mockFetch(body: unknown, calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}
const NO_QUOTE = { data: { rfqId: "r1", claimToken: "c1", status: "no_quote" } };

describe("externally signed TakerControl proofs", () => {
  it("builds typed data a wallet can sign and the taker recovers from", async () => {
    const nonce = takerControlNonce();
    const td = takerControlTypedData(account.address, 42220, nonce, 1_760_000_000_000);
    expect(td.domain).toEqual({ name: "Textile Taker Control", version: "1", chainId: 42220 });
    const signature = await account.signTypedData(td);
    expect(await recoverTypedDataAddress({ ...td, signature })).toBe(account.address);
  });

  it("builds the documented eip191 text, lowercased, byte for byte", async () => {
    const nonce = `0x${"AB".repeat(32)}` as const;
    const msg = takerControlMessage(account.address, 42220, nonce, 1_756_400_000_000);
    expect(msg).toBe(
      [
        "Textile Taker Control",
        "Version: 1",
        "",
        "Sign to prove you control this wallet so Textile can request a firm",
        "quote for it. This does not approve any transfer, trade or allowance.",
        "",
        `Wallet: ${account.address.toLowerCase()}`,
        "Chain: 42220",
        `Nonce: 0x${"ab".repeat(32)}`,
        "Issued at: 1756400000000",
      ].join("\n"),
    );
    const signature = await account.signMessage({ message: msg });
    expect(await recoverMessageAddress({ message: msg, signature })).toBe(account.address);
  });

  it("passes a wallet-signed proof through as is (scheme only for eip191)", async () => {
    const calls: Call[] = [];
    const c = new TextileClient("https://x/v2", undefined, mockFetch(NO_QUOTE, calls));
    expect(c.hasPartnerKey).toBe(false);
    const proof = { nonce: `0x${"11".repeat(32)}` as const, issuedAt: 1_760_000_000_000, signature: "0xdead" as const };
    const trade = { chainId: 42220, sellToken: USDT.address, buyToken: wBRL.address, sellAmount: 1_000_000n, taker: account.address };
    await c.request({ ...trade, takerProof: { ...proof, scheme: "eip712" } });
    await c.request({ ...trade, takerProof: { ...proof, scheme: "eip191" } });
    expect(JSON.parse(calls[0]!.init.body as string).takerProof).toEqual(proof);
    expect(JSON.parse(calls[1]!.init.body as string).takerProof).toEqual({ ...proof, scheme: "eip191" });
    expect(new TextileClient("https://x/v2", "tx_live_k", mockFetch(NO_QUOTE, [])).hasPartnerKey).toBe(true);
  });
});
