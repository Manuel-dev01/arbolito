import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { CONTRACTS, TOKENS } from "@arbolito/config";
import { attributionCodes } from "@arbolito/chain";
import { erc20Abi, swapRouter02Abi } from "@arbolito/router";
import { SendPrepareResponse } from "../src/lib/miniapp/contract";
import { setDeps } from "../src/lib/miniapp/server/deps";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { createQuote } from "../src/lib/miniapp/server/quote";
import { prepareSend } from "../src/lib/miniapp/server/send";
import { submitQuote } from "../src/lib/miniapp/server/submit";
import { ACCOUNT, CLAIM, CODE, OTHER, REACTOR, firmQuote, makeRig, mineCalls, transferLog, usdtToWars, wallet } from "./miniapp-helpers";

const { USDT, wARS } = TOKENS;
const E18 = 10n ** 18n;
const CONTACT = OTHER.toLowerCase() as Address;

async function failure(p: Promise<unknown>): Promise<ApiFailure> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  throw new Error("expected an ApiFailure");
}

afterEach(() => {
  vi.restoreAllMocks();
  setDeps(undefined);
});

describe("POST /send/prepare: send to a contact", () => {
  it("same currency: one tagged transfer to the contact, nothing to quote", async () => {
    const rig = makeRig();
    const r = SendPrepareResponse.parse(await prepareSend(rig.deps, { account: wallet.address, recipient: OTHER, from: "USDT", to: "USDT", amount: "5" }));
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.to).toBe(USDT.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: r.calls[0]!.data as Hex }).args).toEqual([OTHER, 5_000_000n]);
    expect(attributionCodes(r.calls[0]!.data as Hex)).toContain(CODE);
    expect([r.expectedOut, r.minOut, r.quoteId]).toEqual(["5000000", "5000000", undefined]);
    expect(rig.store.quotes).toHaveLength(0);
  });

  it("refuses sending to yourself, a cross-currency send without a quote, and a quote for another size", async () => {
    const rig = makeRig();
    expect((await failure(prepareSend(rig.deps, { account: wallet.address, recipient: wallet.address, from: "USDT", to: "USDT", amount: "5" }))).code).toBe("bad_request");
    expect((await failure(prepareSend(rig.deps, { account: wallet.address, recipient: OTHER, from: "USDT", to: "wARS", amount: "10" }))).code).toBe("bad_request");
    const q = await createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "10" });
    const f = await failure(prepareSend(rig.deps, { account: wallet.address, recipient: OTHER, from: "USDT", to: "wARS", amount: "20", quoteId: q.quoteId }));
    expect([f.code, f.status]).toEqual(["bad_request", 409]);
    expect(rig.store.quotes[0]!.status).toBe("quoted"); // a mismatch never consumes the quote
  });

  it("Uniswap: the swap pays the contact directly; the receipt names them and counts what they got", async () => {
    const rig = makeRig();
    const q = await createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "10" });
    const r = SendPrepareResponse.parse(await prepareSend(rig.deps, { account: wallet.address, recipient: OTHER, from: "USDT", to: "wARS", amount: "10", quoteId: q.quoteId }));
    expect(r.quoteId).toBe(q.quoteId);
    expect(r.calls.map((c) => c.to)).toEqual([USDT.address, CONTRACTS.uniswap.swapRouter02]);
    const swap = decodeFunctionData({ abi: swapRouter02Abi, data: r.calls[1]!.data as Hex });
    expect((swap.args[0] as { recipient: Address }).recipient.toLowerCase()).toBe(CONTACT);

    const delivered = 15_990n * E18;
    const hashes = mineCalls(rig, r.calls, {
      tamper: (i, tx) => (i === 1 ? { ...tx, logs: [transferLog(wARS.address, CONTRACTS.uniswap.swapRouter02 as Address, CONTACT, delivered)] } : tx),
    });
    const s = await submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes: hashes });
    const row = rig.store.receipts.find((x) => x.id === s.receiptId)!;
    expect(row).toMatchObject({ amountOut: delivered.toString(), taker: ACCOUNT, executionTx: hashes[1] });
    const bundle = row.bundle as { request: { taker: string; recipient?: string }; execution: { amountOut: string; deliveryTxHash?: string } };
    expect(bundle.request).toMatchObject({ taker: ACCOUNT, recipient: CONTACT });
    expect(bundle.execution.amountOut).toBe(delivered.toString());
    expect(bundle.execution.deliveryTxHash).toBeUndefined();
  });

  it("Textile: swap to the sender, then forward exactly the firm amount; the receipt links both txs", async () => {
    const rig = makeRig();
    rig.textile.hasPartnerKey = true;
    rig.textileVenue.pairs["USDT>wARS"] = usdtToWars(1700n);
    const q = await createQuote(rig.deps, { from: "USDT", to: "wARS", amount: "10", account: wallet.address });
    expect(q.usesTextile).toBe(true);
    const firmOut = 17_000n * E18;
    rig.textile.firm = (p) => firmQuote(p.taker, p.sellAmount, firmOut);

    const r = SendPrepareResponse.parse(await prepareSend(rig.deps, { account: wallet.address, recipient: OTHER, from: "USDT", to: "wARS", amount: "10", quoteId: q.quoteId }));
    expect(JSON.stringify(r)).not.toContain(CLAIM);
    expect(rig.textile.requests[0]).toMatchObject({ taker: ACCOUNT }); // Textile always settles to the taker
    expect(r.calls.map((c) => c.to)).toEqual([USDT.address, REACTOR, wARS.address]);
    expect(decodeFunctionData({ abi: erc20Abi, data: r.calls[2]!.data as Hex }).args).toEqual([CONTACT, firmOut]);
    for (const c of r.calls) expect(attributionCodes(c.data as Hex)).toContain(CODE);

    const hashes = mineCalls(rig, r.calls, {
      tamper: (i, tx) =>
        i === 1 ? { ...tx, logs: [transferLog(wARS.address, REACTOR, ACCOUNT, firmOut)] } : i === 2 ? { ...tx, logs: [transferLog(wARS.address, ACCOUNT, CONTACT, firmOut)] } : tx,
    });
    const s = await submitQuote(rig.deps, { quoteId: q.quoteId, account: wallet.address, txHashes: hashes });
    expect(rig.textile.submits).toEqual([{ rfqId: "rfq-1", claim: CLAIM, hash: hashes[1] }]); // the swap, not the forward
    const row = rig.store.receipts.find((x) => x.id === s.receiptId)!;
    expect(row).toMatchObject({ amountOut: firmOut.toString(), executionTx: hashes[1] });
    const bundle = row.bundle as { request: { recipient?: string }; execution: { txHash: string; deliveryTxHash?: string } };
    expect(bundle.request.recipient).toBe(CONTACT);
    expect(bundle.execution).toMatchObject({ txHash: hashes[1], deliveryTxHash: hashes[2] });
  });
});
