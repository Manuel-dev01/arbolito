import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { TOKENS } from "@arbolito/config";
import type { Call } from "../src/lib/miniapp/contract";
import { createApiClient } from "../src/lib/miniapp/client/api";
import { executeQuote } from "../src/lib/miniapp/client/execute";
import { createMockServer, createMockWallet, MOCK_ACCOUNT } from "../src/lib/miniapp/client/mock";
import {
  createViemSender,
  detectMiniPay,
  FEE_ADAPTERS,
  getAccount,
  isUserRejection,
  pickFeeCurrency,
  sendCallsInOrder,
  signTakerProof,
  type Eip1193Provider,
  type ReceiptWaiter,
} from "../src/lib/miniapp/client/wallet";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const calls: Call[] = [
  { to: "0x0000000000000000000000000000000000000001", data: "0x095ea7b3aa", value: "0", label: "approve" },
  { to: "0x0000000000000000000000000000000000000002", data: "0x3593564cbb", value: "0", label: "swap" },
];

/** A fake EIP-1193 MiniPay: records eth_sendTransaction in order, can reject a given call. */
function fakeProvider(opts: { rejectAt?: number; errorAt?: number } = {}) {
  const sent: { to: string; data: string; feeCurrency?: string }[] = [];
  const provider: Eip1193Provider = {
    isMiniPay: true,
    async request({ method, params }) {
      if (method === "eth_chainId") return "0xa4ec";
      if (method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_sendTransaction") {
        const tx = (params as { to: string; data: string; feeCurrency?: string }[])[0]!;
        const i = sent.length;
        if (opts.rejectAt === i) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        if (opts.errorAt === i) throw Object.assign(new Error("internal error"), { code: -32603 });
        sent.push(tx);
        return `0x${(i + 1).toString(16).padStart(64, "0")}`;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
  return { provider, sent };
}

const waiter = (statuses: Record<number, "success" | "reverted" | "throw"> = {}): ReceiptWaiter & { waited: Hex[] } => {
  const waited: Hex[] = [];
  return {
    waited,
    async wait(hash) {
      waited.push(hash);
      const s = statuses[waited.length - 1] ?? "success";
      if (s === "throw") throw new Error("timeout");
      return s;
    },
  };
};

describe("detect MiniPay and auto-connect", () => {
  it("requires isMiniPay", () => {
    expect(detectMiniPay({}).kind).toBe("none");
    expect(detectMiniPay({ ethereum: { request: async () => [] } }).kind).toBe("none");
    expect(detectMiniPay({ ethereum: { isMiniPay: true, request: async () => [] } }).kind).toBe("minipay");
  });
  it("reads the account with eth_accounts", async () => {
    expect(await getAccount(fakeProvider().provider)).toBe(ACCOUNT);
  });
});

describe("Call sequencer (viem wallet client over a fake provider)", () => {
  it("sends every call in order, waiting for each receipt, with the fee adapter", async () => {
    const { provider, sent } = fakeProvider();
    const w = waiter();
    const out = await sendCallsInOrder(calls, createViemSender(provider, ACCOUNT, () => FEE_ADAPTERS.USDT), w);
    expect(out.kind).toBe("sent");
    expect(sent.map((t) => t.data)).toEqual(["0x095ea7b3aa", "0x3593564cbb"]);
    expect(sent.map((t) => t.to)).toEqual([calls[0]!.to, calls[1]!.to]);
    expect(sent[0]!.feeCurrency?.toLowerCase()).toBe(FEE_ADAPTERS.USDT!.toLowerCase());
    expect(w.waited).toHaveLength(2);
    if (out.kind === "sent") expect(out.hashes).toEqual(w.waited);
  });
  it("maps a MiniPay rejection (4001) to cancelled and stops", async () => {
    const { provider, sent } = fakeProvider({ rejectAt: 1 });
    const out = await sendCallsInOrder(calls, createViemSender(provider, ACCOUNT), waiter());
    expect(out).toMatchObject({ kind: "cancelled", atIndex: 1 });
    expect(sent).toHaveLength(1);
  });
  it("maps a reverted receipt to failed and never sends the next call", async () => {
    const { provider, sent } = fakeProvider();
    const out = await sendCallsInOrder(calls, createViemSender(provider, ACCOUNT), waiter({ 0: "reverted" }));
    expect(out).toMatchObject({ kind: "failed", reason: "reverted", atIndex: 0 });
    expect(sent).toHaveLength(1);
  });
  it("treats a non-rejection send error or a receipt timeout as unknown (never retried)", async () => {
    const a = await sendCallsInOrder(calls, createViemSender(fakeProvider({ errorAt: 0 }).provider, ACCOUNT), waiter());
    expect(a).toMatchObject({ kind: "failed", reason: "unknown", atIndex: 0 });
    const b = await sendCallsInOrder(calls, createViemSender(fakeProvider().provider, ACCOUNT), waiter({ 1: "throw" }));
    expect(b).toMatchObject({ kind: "failed", reason: "unknown", atIndex: 1 });
  });
  it("recognises rejections through viem's error wrapping", () => {
    expect(isUserRejection({ cause: { cause: { code: 4001 } } })).toBe(true);
    expect(isUserRejection({ name: "UserRejectedRequestError" })).toBe(true);
    expect(isUserRejection(new Error("boom"))).toBe(false);
  });
});

describe("fee currency and taker proof", () => {
  it("fee adapters mirror the config package", () => {
    expect(FEE_ADAPTERS.USDT).toBe(TOKENS.USDT.feeCurrencyAdapter);
    expect(FEE_ADAPTERS.USDC).toBe(TOKENS.USDC.feeCurrencyAdapter);
    expect(FEE_ADAPTERS.USAT).toBe(TOKENS.USAT.feeCurrencyAdapter);
  });
  it("picks the adapter of the largest dollar balance", () => {
    expect(pickFeeCurrency([{ sym: "USDC", amount: "5" }, { sym: "USDT", amount: "2" }, { sym: "wARS", amount: "999999" }])).toBe(FEE_ADAPTERS.USDC);
    expect(pickFeeCurrency(undefined)).toBe(FEE_ADAPTERS.USDT);
  });
  it("signs EIP-712 first and falls back to personal_sign", async () => {
    const needs = { typedData: { a: 1 }, eip191Message: "msg", nonce: "0x01", issuedAt: 1 } as const;
    const ok = await signTakerProof({ signTypedData: async () => "0xaa", personalSign: async () => "0xbb" }, needs);
    expect(ok).toEqual({ nonce: "0x01", issuedAt: 1, signature: "0xaa", scheme: "eip712" });
    const fb = await signTakerProof({ signTypedData: async () => { throw new Error("unsupported"); }, personalSign: async () => "0xbb" }, needs);
    expect(fb.scheme).toBe("eip191");
    await expect(signTakerProof({ signTypedData: async () => { throw { code: 4001 }; }, personalSign: async () => "0xbb" }, needs)).rejects.toBeTruthy();
  });
});

describe("execute flow against the mock server", () => {
  const setup = (fail: Parameters<typeof createMockServer>[0]["fail"], answer = true) => {
    const server = createMockServer({ fail });
    const api = createApiClient({ fetch: server.fetch });
    const sheets: string[] = [];
    const wallet = createMockWallet({ lang: "es", fail, confirm: async (r) => (sheets.push(`${r.kind}:${r.label}`), answer) });
    return { api, wallet, sheets };
  };

  it("quotes R$ 10 → ARS 3.177,41 and runs prepare → send → submit", async () => {
    const { api, wallet, sheets } = setup(null);
    const q = await api.quote({ from: "wBRL", to: "wARS", amount: "10", account: MOCK_ACCOUNT });
    expect(q.expectedOut.startsWith("3177411")).toBe(true);
    expect(q.vsOfficial?.pct).toBe(5.24);
    const r = await executeQuote({ api, wallet, retryDelayMs: 0 }, q.quoteId);
    expect(r.kind).toBe("done");
    expect(sheets).toEqual(["tx:Aprobar wBRL", "tx:Cambiar wBRL → wARS"]);
    if (r.kind === "done") expect(r.receipt?.status).toBe("registering");
  }, 15_000);

  it("signs the taker proof when /prepare answers 409 and retries prepare once", async () => {
    const { api, wallet, sheets } = setup("proof");
    const q = await api.quote({ from: "wBRL", to: "wARS", amount: "10" });
    const r = await executeQuote({ api, wallet, retryDelayMs: 0 }, q.quoteId);
    expect(r.kind).toBe("done");
    expect(sheets[0]).toBe("sign:Textile");
  }, 15_000);

  it("a rejection in the sheet is cancelled; a reverted swap is failed", async () => {
    const a = setup(null, false);
    const qa = await a.api.quote({ from: "wBRL", to: "wARS", amount: "10" });
    expect((await executeQuote({ api: a.api, wallet: a.wallet, retryDelayMs: 0 }, qa.quoteId)).kind).toBe("cancelled");
    const b = setup("revert");
    const qb = await b.api.quote({ from: "wBRL", to: "wARS", amount: "10" });
    expect(await executeQuote({ api: b.api, wallet: b.wallet, retryDelayMs: 0 }, qb.quoteId)).toMatchObject({ kind: "failed", reason: "reverted" });
  }, 15_000);

  it("surfaces contract error codes before anything is sent", async () => {
    const { api, wallet, sheets } = setup("price_changed");
    const q = await api.quote({ from: "wBRL", to: "wARS", amount: "10" });
    expect(await executeQuote({ api, wallet, retryDelayMs: 0 }, q.quoteId)).toEqual({ kind: "api-error", code: "price_changed" });
    expect(sheets).toEqual([]);
    const nr = setup("no_route");
    await expect(nr.api.quote({ from: "wBRL", to: "wARS", amount: "10" })).rejects.toMatchObject({ code: "no_route" });
  }, 15_000);
});
