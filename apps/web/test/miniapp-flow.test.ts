import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, TOKENS } from "@arbolito/config";
import { attributionCodes } from "@arbolito/chain";
import { erc20Abi, swapRouter02Abi, takerControlTypedData } from "@arbolito/router";
import { POST as prepareRoute } from "../src/app/api/miniapp/prepare/route";
import { POST as quoteRoute } from "../src/app/api/miniapp/quote/route";
import { NeedsTakerProof, PrepareResponse, QuoteResponse, ReceiptResponse, SubmitResponse } from "../src/lib/miniapp/contract";
import { setDeps } from "../src/lib/miniapp/server/deps";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { prepareQuote, type Prepared } from "../src/lib/miniapp/server/prepare";
import { createQuote } from "../src/lib/miniapp/server/quote";
import { getMiniappReceipt } from "../src/lib/miniapp/server/receipt";
import { submitQuote } from "../src/lib/miniapp/server/submit";
import { ACCOUNT, CLAIM, CODE, REACTOR, SWAP_DATA, T0, firmQuote, makeRig, mineCalls, usdtToWars, wallet, type TestRig } from "./miniapp-helpers";

const { USDT, wARS, wBRL } = TOKENS;
const E18 = 10n ** 18n;

async function failure(p: Promise<unknown>): Promise<ApiFailure> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  throw new Error("expected an ApiFailure");
}

const post = (body: unknown) => new Request("https://arbolito.test/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

let errors: string[];
beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(" ")));
});
afterEach(() => {
  vi.restoreAllMocks();
  setDeps(undefined);
  // The claim token is a bearer capability: it must never be logged.
  expect(errors.join("\n")).not.toContain(CLAIM);
});

describe("POST /quote", () => {
  it("quotes the best wallet-executable route, stores it ~60 s and maps it to the contract", async () => {
    const rig = makeRig();
    const q = await createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "10", account: wallet.address, lang: "es" });
    expect(QuoteResponse.parse(q)).toBeTruthy();
    expect(q.amountIn).toBe("10000000");
    expect(q.expectedOut).toBe((16_000n * E18).toString());
    expect(q.minOut).toBe(((16_000n * E18 * 9950n) / 10_000n).toString());
    expect(q.rate).toBe("1600");
    expect(q.venues).toEqual(["uniswap"]);
    expect(q.usesTextile).toBe(false);
    expect(q.steps).toBe(1);
    // Official USD/ARS 1500 → 15,000 wARS reference; we deliver 16,000 (+6.66%).
    expect(q.vsOfficial).toEqual({ pct: 6.66, pair: "USD/ARS", deltaOut: (1_000n * E18).toString() });
    expect(Date.parse(q.expiresAt) - T0).toBe(60_000);
    const row = rig.store.quotes[0]!;
    expect(row).toMatchObject({ id: q.quoteId, account: ACCOUNT, fromSym: "USDT", toSym: "wARS", amountIn: "10000000", status: "quoted" });
  });

  it("refuses too many decimals, zero and same-token pairs", async () => {
    const rig = makeRig();
    expect((await failure(createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "1.0000001" }))).code).toBe("bad_request");
    expect((await failure(createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "0" }))).code).toBe("bad_request");
    expect((await failure(createQuote(rig.deps, { from: "USDT", to: "USDT", amount: "1" }))).code).toBe("bad_request");
  });

  it("answers no_route when no venue can quote", async () => {
    const rig = makeRig();
    const f = await failure(createQuote(rig.deps, { from: "USDC", to: "wBRL", amount: "5" }));
    expect([f.code, f.status]).toEqual(["no_route", 422]);
  });

  it("keeps mixed Uniswap+Textile routes as alternatives only", async () => {
    const rig = makeRig();
    rig.textileVenue.pairs["USDT>wARS"] = usdtToWars(1700n); // Textile beats Uniswap on the second hop
    const q = await createQuote(rig.deps, { from: "wBRL", to: "wARS", amount: "50" });
    expect(q.venues).toEqual(["uniswap"]);
    expect(q.steps).toBe(2);
    expect(q.usesTextile).toBe(false);
    const mixed = q.alternatives.find((a) => a.venues.includes("textile"));
    expect(mixed).toBeTruthy();
    expect(mixed!.diffBps).toBeGreaterThan(0);
  });

  it("executes a Textile-only route when it is best, unless TEXTILE_RFQ_ENABLED is off", async () => {
    const rig = makeRig();
    rig.textileVenue.pairs["USDT>wARS"] = usdtToWars(1700n);
    const q = await createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "10" });
    expect([q.venues, q.usesTextile]).toEqual([["textile"], true]);

    const off = makeRig({ textileEnabled: false });
    off.textileVenue.pairs["USDT>wARS"] = usdtToWars(1700n);
    const q2 = await createQuote(off.deps, { from: "USDT", to: "wARS", amount: "10" });
    expect(q2.venues).toEqual(["uniswap"]);
    expect(q2.alternatives[0]!.venues).toEqual(["textile"]);
  });

  it("route handler validates the body and returns the contract error shape", async () => {
    const rig = makeRig();
    setDeps(rig.deps);
    const res = await quoteRoute(post({ from: "USDT", to: "DOGE", amount: "1" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
    const ok = await quoteRoute(post({ from: "USDT", to: "wARS", amount: "2.5" }));
    expect(ok.status).toBe(200);
    expect(QuoteResponse.parse(await ok.json()).amountIn).toBe("2500000");
  });
});

describe("Uniswap: quote → prepare → submit", () => {
  async function quoted(rig: TestRig) {
    return createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "10" });
  }

  it("returns tagged approve + swap, then registers the receipt from the swap's Transfer logs", async () => {
    const rig = makeRig();
    const q = await quoted(rig);
    const p = PrepareResponse.parse(await prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address }));
    expect(p.calls.map((c) => c.to)).toEqual([USDT.address, CONTRACTS.uniswap.swapRouter02]);
    for (const c of p.calls) expect(attributionCodes(c.data as Hex)).toContain(CODE);
    const approve = decodeFunctionData({ abi: erc20Abi, data: p.calls[0]!.data as Hex });
    expect(approve.args).toEqual([CONTRACTS.uniswap.swapRouter02, 10_000_000n]);
    const swap = decodeFunctionData({ abi: swapRouter02Abi, data: p.calls[1]!.data as Hex });
    expect(swap.functionName).toBe("exactInputSingle");
    expect((swap.args[0] as { recipient: Address; amountOutMinimum: bigint }).recipient.toLowerCase()).toBe(ACCOUNT);
    expect((swap.args[0] as { amountOutMinimum: bigint }).amountOutMinimum.toString()).toBe(q.minOut);
    expect(p.minOut).toBe(q.minOut);
    expect(rig.store.quotes[0]!.status).toBe("prepared");
    expect(rig.store.quotes[0]!.account).toBe(ACCOUNT); // bound at prepare

    const delivered = 15_990n * E18; // what the swap actually delivered, not the quote
    const hashes = mineCalls(rig, p.calls, { delivered: { token: wARS.address, amount: delivered } });
    const s = SubmitResponse.parse(await submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes: hashes }));
    expect(s.status).toBe("registering"); // anchoring is off in tests
    expect(s.url).toBe(`https://arbolito.test/r/${s.receiptId}`);
    const row = rig.store.receipts[0]!;
    expect(row).toMatchObject({ id: s.receiptId, amountIn: "10000000", amountOut: delivered.toString(), taker: ACCOUNT, executionTx: hashes[1], anchorTx: null, usdMicros: "10000000" });
    expect(row.userId).toBe(rig.store.users.find((u) => u.walletAddress === ACCOUNT)!.id);
    const bundle = row.bundle as { request: { taker: string }; execution: { amountOut: string; attribution: string[] } };
    expect(bundle.request.taker).toBe(ACCOUNT);
    expect(bundle.execution).toMatchObject({ amountOut: delivered.toString(), attribution: [CODE] });
    expect(rig.store.quotes[0]).toMatchObject({ status: "submitted", receiptId: s.receiptId });

    // Re-submitting is idempotent.
    const again = await submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes: hashes });
    expect(again.receiptId).toBe(s.receiptId);
    expect(rig.store.receipts).toHaveLength(1);

    const r = ReceiptResponse.parse(await getMiniappReceipt(rig.deps, s.receiptId));
    expect(r).toMatchObject({ status: "registering", from: "USDT", to: "wARS", amountOut: delivered.toString(), anchorTx: null, executionTx: hashes[1] });
    expect(r.savings?.pair).toBe("USD/ARS");
  });

  it("skips the approve when the allowance already covers it", async () => {
    const rig = makeRig();
    rig.chain.allowances.set(`${USDT.address}:${ACCOUNT}:${CONTRACTS.uniswap.swapRouter02}`.toLowerCase(), 10n ** 12n);
    const q = await quoted(rig);
    const p = await prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address });
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0]!.label).toContain("exactInputSingle");
  });

  it("re-quotes at prepare and refuses with price_changed below the shown minimum", async () => {
    const rig = makeRig();
    const q = await quoted(rig);
    rig.uni.pairs["USDT>wARS"] = usdtToWars(1590n); // -0.6%, beyond the 0.5% slippage
    const f = await failure(prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address }));
    expect([f.code, f.status]).toEqual(["price_changed", 409]);
    expect(rig.store.quotes[0]!.status).toBe("quoted");

    rig.uni.pairs["USDT>wARS"] = usdtToWars(1595n); // -0.31%: still above the minimum
    const p = await prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address });
    expect(p.expectedOut).toBe((15_950n * E18).toString());
    expect(p.minOut).toBe(q.minOut);
  });

  it("refuses an expired quote, another wallet's quote and an unknown one", async () => {
    const rig = makeRig();
    const q = await createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "10", account: wallet.address });
    expect((await failure(prepareQuote(rig.deps, { quoteId: q.quoteId, account: "0x2222222222222222222222222222222222222222" }))).status).toBe(403);
    expect((await failure(prepareQuote(rig.deps, { quoteId: crypto.randomUUID(), account: wallet.address }))).status).toBe(404);
    rig.clock.now += 61_000;
    const f = await failure(prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address }));
    expect([f.code, f.status]).toEqual(["quote_expired", 410]);
  });

  it("needs ATTRIBUTION_CODE to prepare anything", async () => {
    const rig = makeRig({ attributionCode: undefined });
    const q = await quoted(rig);
    expect((await failure(prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address }))).code).toBe("not_ready");
  });

  it("anchors through the injected anchor (never live in tests) and then reports verified", async () => {
    const anchored: string[] = [];
    const rig = makeRig({
      anchor: async (b) => {
        anchored.push(b.routeId);
        return { txHash: `0x${"aa".repeat(32)}`, blockNumber: 80_000_010n };
      },
    });
    const q = await quoted(rig);
    const p = await prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address });
    const hashes = mineCalls(rig, p.calls, { delivered: { token: wARS.address, amount: 16_000n * E18 } });
    const s = await submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes: hashes });
    expect(s.status).toBe("verified");
    expect(anchored).toEqual([s.receiptId]);
    expect(rig.store.receipts[0]!.anchorTx).toBe(`0x${"aa".repeat(32)}`);
    expect((await getMiniappReceipt(rig.deps, s.receiptId)).status).toBe("verified");
    rig.deps.verify = async () => ({ ok: false, errors: ["amount mismatch"] });
    expect((await getMiniappReceipt(rig.deps, s.receiptId)).status).toBe("mismatch");
  });
});

describe("Textile: 409 proof → firm quote → submit", () => {
  async function textileQuote(rig: TestRig) {
    rig.textileVenue.pairs["USDT>wARS"] = usdtToWars(1700n);
    const q = await createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "10", account: wallet.address });
    expect(q.usesTextile).toBe(true);
    rig.textile.firm = (p) => firmQuote(p.taker, p.sellAmount, 17_000n * E18);
    return q;
  }

  async function challenge(rig: TestRig, quoteId: string) {
    setDeps(rig.deps);
    const res = await prepareRoute(post({ quoteId, account: wallet.address }));
    expect(res.status).toBe(409);
    return NeedsTakerProof.parse(await res.json());
  }

  it("asks for the one-time proof, then returns approve + swap without ever exposing the claim token", async () => {
    const rig = makeRig();
    const q = await textileQuote(rig);
    const body = await challenge(rig, q.quoteId);
    expect(body.error.code).toBe("needs_taker_proof");
    expect(rig.textile.requests).toHaveLength(0); // no firm request without a proof
    const td = body.typedData as { domain: unknown; primaryType: string; message: { taker: string; chainId: number } };
    expect(td.domain).toEqual({ name: "Textile Taker Control", version: "1", chainId: 42220 });
    expect(td.primaryType).toBe("TakerControl");
    expect(td.message).toMatchObject({ taker: ACCOUNT, chainId: 42220 });
    expect(body.eip191Message).toContain(`Wallet: ${ACCOUNT}`);

    const signature = await wallet.signTypedData(takerControlTypedData(wallet.address, 42220, body.nonce as Hex, body.issuedAt));
    const takerProof = { nonce: body.nonce, issuedAt: body.issuedAt, signature, scheme: "eip712" as const };
    const res = await prepareRoute(post({ quoteId: q.quoteId, account: wallet.address, takerProof }));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(CLAIM);
    const p = PrepareResponse.parse(JSON.parse(text));
    expect(rig.textile.requests[0]).toMatchObject({ taker: ACCOUNT, sellAmount: 10_000_000n, takerProof: { nonce: body.nonce, signature } });
    expect(p.calls.map((c) => c.to)).toEqual([USDT.address, REACTOR]);
    expect(decodeFunctionData({ abi: erc20Abi, data: p.calls[0]!.data as Hex }).args).toEqual([REACTOR, 10_000_000n]);
    expect(p.calls[1]!.data.startsWith(SWAP_DATA)).toBe(true);
    for (const c of p.calls) expect(attributionCodes(c.data as Hex)).toContain(CODE);
    expect([p.expectedOut, p.minOut]).toEqual([(17_000n * E18).toString(), (17_000n * E18).toString()]);
    expect(Date.parse(p.expiresAt)).toBe(T0 + 55_000);
    // Stored server-side only.
    expect((rig.store.quotes[0]!.prepared as Prepared & { claimToken: string }).claimToken).toBe(CLAIM);

    // A second prepare while the firm quote is live reuses it (no new inventory lock).
    const again = await prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address });
    expect(again.calls).toEqual(p.calls);
    expect(rig.textile.requests).toHaveLength(1);

    const hashes = mineCalls(rig, p.calls, { delivered: { token: wARS.address, amount: 17_000n * E18 } });
    const s = await submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes: hashes });
    expect(JSON.stringify(s)).not.toContain(CLAIM);
    expect(rig.textile.submits).toEqual([{ rfqId: "rfq-1", claim: CLAIM, hash: hashes[1] }]);
    const bundle = rig.store.receipts[0]!.bundle as { chosen: { legs: { quote: { venue: string; firm: boolean; raw: Record<string, unknown> } }[] } };
    expect(JSON.stringify(bundle)).not.toContain(CLAIM);
    expect(bundle.chosen.legs[0]!.quote).toMatchObject({ venue: "textile_rfq", firm: true, raw: { kind: "firm", rfqId: "rfq-1" } });
    expect((rig.store.quotes[0]!.prepared as Prepared & { report: unknown }).report).toMatchObject({ status: "submitted" });
    const r = await getMiniappReceipt(rig.deps, s.receiptId);
    expect(JSON.stringify(r)).not.toContain(CLAIM);
  });

  it("accepts the eip191 (personal_sign) fallback", async () => {
    const rig = makeRig();
    const q = await textileQuote(rig);
    const body = await challenge(rig, q.quoteId);
    const signature = await wallet.signMessage({ message: body.eip191Message });
    const p = await prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, takerProof: { nonce: body.nonce, issuedAt: body.issuedAt, signature, scheme: "eip191" } });
    expect(p.calls).toHaveLength(2);
    expect(rig.textile.requests[0]!.takerProof).toMatchObject({ scheme: "eip191" });
  });

  it("refuses a proof from another key and re-challenges a stale one", async () => {
    const rig = makeRig();
    const q = await textileQuote(rig);
    const body = await challenge(rig, q.quoteId);
    const intruder = privateKeyToAccount(`0x${"7".repeat(64)}`);
    const bad = await intruder.signTypedData(takerControlTypedData(wallet.address, 42220, body.nonce as Hex, body.issuedAt));
    const f = await failure(prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, takerProof: { nonce: body.nonce, issuedAt: body.issuedAt, signature: bad, scheme: "eip712" } }));
    expect([f.code, f.status]).toEqual(["bad_request", 400]);

    // Signed 61 s ago: past Textile's 60 s eip712 window while the quote itself is still live.
    const oldAt = T0 - 61_000;
    const old = await wallet.signTypedData(takerControlTypedData(wallet.address, 42220, body.nonce as Hex, oldAt));
    const stale = await failure(prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, takerProof: { nonce: body.nonce, issuedAt: oldAt, signature: old, scheme: "eip712" } }));
    expect([stale.code, stale.status]).toEqual(["needs_taker_proof", 409]);
    expect(stale.extra).toMatchObject({ eip191Message: expect.stringContaining("Textile Taker Control") });
    // The same age is fine for eip191 (5-minute window).
    const msg191 = (await challenge(rig, q.quoteId)).eip191Message.replace(/Issued at: \d+/, `Issued at: ${oldAt}`).replace(/Nonce: 0x[0-9a-f]+/, `Nonce: ${body.nonce.toLowerCase()}`);
    const sig191 = await wallet.signMessage({ message: msg191 });
    await prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, takerProof: { nonce: body.nonce, issuedAt: oldAt, signature: sig191, scheme: "eip191" } });
    expect(rig.textile.requests).toHaveLength(1);
  });

  it("cancels the RFQ and answers price_changed when the firm quote is below the minimum", async () => {
    const rig = makeRig();
    const q = await textileQuote(rig);
    rig.textile.firm = (p) => firmQuote(p.taker, p.sellAmount, 16_000n * E18); // preview said 17,000
    const body = await challenge(rig, q.quoteId);
    const signature = await wallet.signTypedData(takerControlTypedData(wallet.address, 42220, body.nonce as Hex, body.issuedAt));
    const f = await failure(prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, takerProof: { nonce: body.nonce, issuedAt: body.issuedAt, signature, scheme: "eip712" } }));
    expect(f.code).toBe("price_changed");
    expect(rig.textile.cancels).toEqual(["rfq-1"]);
    expect(rig.store.quotes[0]!.prepared).toBeNull();
  });

  it("cancels a firm quote that is about to expire, or bound to another taker", async () => {
    const rig = makeRig();
    const q = await textileQuote(rig);
    rig.textile.firm = (p) => firmQuote(p.taker, p.sellAmount, 17_000n * E18, 10_000);
    const body = await challenge(rig, q.quoteId);
    const signature = await wallet.signTypedData(takerControlTypedData(wallet.address, 42220, body.nonce as Hex, body.issuedAt));
    const proof = { nonce: body.nonce, issuedAt: body.issuedAt, signature, scheme: "eip712" as const };
    expect((await failure(prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, takerProof: proof }))).code).toBe("quote_expired");
    rig.textile.firm = (p) => firmQuote("0x3333333333333333333333333333333333333333", p.sellAmount, 17_000n * E18);
    expect((await failure(prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, takerProof: proof }))).code).toBe("upstream");
    expect(rig.textile.cancels).toEqual(["rfq-1", "rfq-1"]);
  });

  it("skips the proof with a partner key, and reads status (no retry) when /submit fails", async () => {
    const rig = makeRig();
    rig.textile.hasPartnerKey = true;
    rig.textile.submitError = new Error(`boom ${CLAIM}`); // even an error echoing the claim must not be logged raw
    const q = await textileQuote(rig);
    const p = await prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address });
    expect(rig.textile.requests[0]!.takerProof).toBeUndefined();
    const hashes = mineCalls(rig, p.calls, { delivered: { token: wARS.address, amount: 17_000n * E18 } });
    const s = await submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes: hashes });
    expect(s.status).toBe("registering");
    expect(rig.textile.submits).toHaveLength(1);
    expect(rig.textile.statusCalls).toBe(1);
    expect((rig.store.quotes[0]!.prepared as Prepared & { report: unknown }).report).toMatchObject({ status: "submit_failed", statusAfter: "filled" });
  });

  it("never prepares Textile when TEXTILE_RFQ_ENABLED is off (stale quote from before the flip)", async () => {
    const rig = makeRig();
    const q = await textileQuote(rig);
    rig.deps.textileEnabled = false;
    expect((await failure(prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address }))).code).toBe("not_ready");
  });
});

describe("POST /submit verification", () => {
  async function prepared(rig: TestRig) {
    const q = await createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "10" });
    const p = await prepareQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address });
    return { q, p };
  }
  const delivered = { token: wARS.address, amount: 16_000n * E18 };

  it("rejects a tx sent by another wallet", async () => {
    const rig = makeRig();
    const { q, p } = await prepared(rig);
    const hashes = mineCalls(rig, p.calls, { delivered, tamper: (i, tx) => (i === 1 ? { ...tx, from: "0x4444444444444444444444444444444444444444" } : tx) });
    const f = await failure(submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes: hashes }));
    expect([f.code, f.message]).toEqual(["bad_request", "Transaction 2 was not sent by this wallet."]);
    expect(rig.store.receipts).toHaveLength(0);
  });

  it("rejects a tx without the attribution suffix", async () => {
    const rig = makeRig();
    const { q, p } = await prepared(rig);
    const core = (rig.store.quotes[0]!.prepared as Prepared).calls.map((c) => c.core);
    const hashes = mineCalls(rig, p.calls, { delivered, tamper: (i, tx) => ({ ...tx, input: core[i]! }) });
    const f = await failure(submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes: hashes }));
    expect(f.message).toContain("attribution");
  });

  it("rejects mismatched calldata or target, a revert, a wrong count and an unknown tx", async () => {
    const rig = makeRig();
    const { q, p } = await prepared(rig);
    const sub = (txHashes: Hex[]) => failure(submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes }));

    const flip = (data: string) => `${data.slice(0, 20)}${data[20] === "0" ? "1" : "0"}${data.slice(21)}` as Hex;
    expect((await sub(mineCalls(rig, p.calls, { delivered, tamper: (i, tx) => (i === 1 ? { ...tx, input: flip(tx.input) } : tx) }))).message).toContain("prepared data");
    expect((await sub(mineCalls(rig, p.calls, { delivered, tamper: (i, tx) => (i === 1 ? { ...tx, to: wBRL.address } : tx) }))).message).toContain("different contract");
    expect((await sub(mineCalls(rig, p.calls, { delivered, tamper: (i, tx) => (i === 1 ? { ...tx, status: "reverted" } : tx) }))).message).toContain("failed onchain");
    expect((await sub(mineCalls(rig, p.calls.slice(1), { delivered }))).message).toContain("Expected 2");
    const unknown = await sub([`0x${"ab".repeat(32)}`, `0x${"cd".repeat(32)}`]);
    expect([unknown.code, unknown.status]).toEqual(["upstream", 502]);
    expect(rig.store.receipts).toHaveLength(0);
    expect(rig.store.quotes[0]!.status).toBe("prepared");
  });

  it("refuses to submit a quote that was never prepared", async () => {
    const rig = makeRig();
    const q = await createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "10" });
    const f = await failure(submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes: [`0x${"ab".repeat(32)}`] }));
    expect(f.status).toBe(409);
  });
});
