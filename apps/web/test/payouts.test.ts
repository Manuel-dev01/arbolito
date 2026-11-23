import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { TOKENS } from "@arbolito/config";
import { ApiFailure, createApiClient } from "../src/lib/miniapp/client/api";
import type { Wallet } from "../src/lib/miniapp/client/wallet";
import { restoreRun, runPayout, settleReceipts, type PayoutDeps, type PayoutItem, type PayoutRun } from "../src/lib/miniapp/client/payout";
import { readFileRecord, type ReceiptRecord } from "../src/lib/data";
import { MAX_STATEMENT, namesFragment, parseNames, parseStatementId, statementId } from "../src/lib/payout-link";
import { buildStatement } from "../src/lib/payouts";

const PAYER = "0x00000000000000000000000000000000000000a1" as Hex;
const item = (n: number, p: Partial<PayoutItem> = {}): PayoutItem => ({
  contactId: `c${n}`,
  name: `P${n}`,
  address: `0x${String(n).padStart(40, "0")}`,
  from: "USDT",
  to: "cNGN",
  amount: "10",
  reviewedOut: "14430000000",
  state: "todo",
  ...p,
});
const run = (...items: PayoutItem[]): PayoutRun => ({ id: "r", at: "2026-11-24T10:00:00.000Z", items });
const states = (r: PayoutRun) => r.items.map((i) => i.state);

/** A rig whose wallet and prices can be made to fail at a given payment or confirmation. */
function rig(o: { quoteOut?: (n: number) => bigint; firmOut?: (n: number) => bigint; sendAt?: (n: number, call: number) => Error | null; waitAt?: (n: number, call: number) => "success" | "reverted" | Error; quoteErr?: (n: number) => Error | null; submitFails?: boolean } = {}) {
  let quotes = 0;
  let current = 0;
  let call = 0;
  let hash = 0;
  const paidTo: string[] = [];
  const approvals: (string | undefined)[] = [];
  const saves: PayoutRun[] = [];
  const reject = vi.fn(async () => ({ quoteId: "", status: "failed" }));
  const submit = vi.fn(async ({ quoteId }: { quoteId: string }) => {
    if (o.submitFails) throw new Error("down");
    return { receiptId: `receipt-${quoteId}`, status: "registering", url: "" };
  });
  const api = {
    quote: async () => {
      current = ++quotes;
      const e = o.quoteErr?.(current);
      if (e) throw e;
      return { quoteId: `q${current}`, expectedOut: (o.quoteOut?.(current) ?? 14_430_000_000n).toString() };
    },
    sendPrepare: async (r: { recipient: string; approveUpTo?: string }) => {
      call = 0;
      approvals.push(r.approveUpTo);
      paidTo.push(r.recipient);
      const c = (data: string) => ({ to: "0x0000000000000000000000000000000000000001", data, value: "0", label: "" });
      return { calls: [c("0x095ea7b3"), c("0x0d335884"), c("0xa9059cbb")], expectedOut: (o.firmOut?.(current) ?? 14_430_000_000n).toString(), minOut: "1" };
    },
    submit,
    reject,
  };
  const wallet = {
    account: PAYER,
    sender: {
      send: async () => {
        call++;
        const e = o.sendAt?.(current, call);
        if (e) throw e;
        return `0x${(++hash).toString(16).padStart(64, "0")}` as Hex;
      },
    },
    waiter: {
      wait: async () => {
        const r = o.waitAt?.(current, call) ?? "success";
        if (r instanceof Error) throw r;
        return r;
      },
    },
  } as unknown as Wallet;
  const deps = { api, wallet, lang: "en", retryDelayMs: 0, save: (r: PayoutRun) => saves.push(r) } as unknown as PayoutDeps;
  return { deps, paidTo, approvals, saves, reject, submit, sends: () => hash };
}

const rejected = () => Object.assign(new Error("User rejected the request."), { code: 4001 });

describe("batch payouts", () => {
  it("pays each payee on their own, with their own receipt", async () => {
    const r = rig();
    const out = await runPayout(r.deps, run(item(1), item(2), item(3)));
    expect(states(out)).toEqual(["paid", "paid", "paid"]);
    expect(out.items.map((i) => i.receiptId)).toEqual(["receipt-q1", "receipt-q2", "receipt-q3"]);
    expect(r.paidTo).toEqual([item(1).address, item(2).address, item(3).address]);
    expect(r.sends()).toBe(9);
  });

  it("asks to approve only what's left in each currency", async () => {
    const r = rig();
    await runPayout(r.deps, run(item(1), item(2, { amount: "2.5" }), item(3, { to: "wARS" }), item(4, { state: "paid" }), item(5, { state: "held" })));
    expect(r.approvals).toEqual(["12500000", "2500000", "10000000"]);
  });

  it("the app's client sends the batch approval to the server", async () => {
    let body: Record<string, unknown> = {};
    const api = createApiClient({ fetch: async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ calls: [], expectedOut: "1", minOut: "1" }), { status: 200, headers: { "content-type": "application/json" } });
    } });
    await api.sendPrepare({ account: PAYER, recipient: item(1).address, from: "USDT", to: "cNGN", amount: "10", approveUpTo: "35000000" });
    expect(body.approveUpTo).toBe("35000000");
  });

  it("saves a payment as sending before its first confirmation opens", async () => {
    const r = rig();
    let savedFirst: string[] | null = null;
    const send = r.deps.wallet.sender.send;
    r.deps.wallet.sender.send = async (c, i) => {
      savedFirst ??= states(r.saves.at(-1)!);
      return send(c, i);
    };
    await runPayout(r.deps, run(item(1), item(2)));
    expect(savedFirst).toEqual(["sending", "todo"]);
  });

  it("never repeats a payment that was mid-flight when the app closed", async () => {
    const r = rig();
    const restored = restoreRun(run(item(1, { state: "sending" }), item(2)));
    expect(states(restored)).toEqual(["unknown", "todo"]);
    expect(states(await runPayout(r.deps, restored))).toEqual(["unknown", "paid"]);
    expect(r.paidTo).toEqual([item(2).address]);
  });

  it("holds a payee past the tolerance without signing, and pays the others", async () => {
    const bad = (14_430_000_000n * 9949n) / 10_000n; // 0.51% under
    const r = rig({ quoteOut: (n) => (n === 1 ? bad : 14_430_000_000n) });
    expect(states(await runPayout(r.deps, run(item(1), item(2))))).toEqual(["held", "paid"]);
    expect(r.paidTo).toEqual([item(2).address]);
  });

  it("holds on the firm price too, releasing the quote", async () => {
    const r = rig({ firmOut: () => (14_430_000_000n * 9940n) / 10_000n });
    const out = await runPayout(r.deps, run(item(1)));
    expect([states(out), out.items[0]!.heldOut]).toEqual([["held"], ((14_430_000_000n * 9940n) / 10_000n).toString()]);
    expect(r.sends()).toBe(0);
    expect(r.reject).toHaveBeenCalledWith({ quoteId: "q1", account: PAYER });
  });

  it("accepts a drop inside the tolerance", async () => {
    const r = rig({ quoteOut: () => (14_430_000_000n * 9950n) / 10_000n, firmOut: () => (14_430_000_000n * 9950n) / 10_000n });
    expect(states(await runPayout(r.deps, run(item(1))))).toEqual(["paid"]);
  });

  it("a cancel stops the run; the rest can continue later and the paid one isn't repeated", async () => {
    let cancel = true;
    const r = rig({ sendAt: (n, c) => (cancel && n === 2 && c === 1 ? rejected() : null) });
    const first = await runPayout(r.deps, run(item(1), item(2), item(3)));
    expect(states(first)).toEqual(["paid", "stopped", "todo"]);
    cancel = false;
    expect(states(await runPayout(r.deps, first))).toEqual(["paid", "paid", "paid"]);
    expect(r.paidTo.filter((a) => a === item(1).address)).toHaveLength(1);
  });

  it("a cancel after the conversion is never retried: the money is in the payer's account", async () => {
    const r = rig({ sendAt: (_n, c) => (c === 3 ? rejected() : null) });
    const out = await runPayout(r.deps, run(item(1), item(2)));
    expect(states(out)).toEqual(["converted", "todo"]);
    expect(states(await runPayout(rig().deps, out))).toEqual(["converted", "paid"]);
  });

  it("an unconfirmed transfer is unknown, never converted, and stops the run", async () => {
    const r = rig({ waitAt: (_n, c) => (c === 3 ? new Error("timeout") : "success") });
    const out = await runPayout(r.deps, run(item(1), item(2)));
    expect(states(out)).toEqual(["unknown", "todo"]);
    expect(out.items[0]!.hashes).toHaveLength(3);
  });

  it("settles an unknown payment as paid only when the server finds every transaction", async () => {
    const lost = run(item(1, { state: "unknown", quoteId: "q9", calls: 3, hashes: ["0x1", "0x2", "0x3"] }), item(2, { state: "unknown", quoteId: "q8", calls: 3, hashes: ["0x1", "0x2"] }));
    const r = rig();
    const out = await settleReceipts(r.deps, lost);
    expect(states(out)).toEqual(["paid", "unknown"]);
    expect(out.items[0]!.receiptId).toBe("receipt-q9");
    expect(states(await settleReceipts(rig({ submitFails: true }).deps, lost))).toEqual(["unknown", "unknown"]);
  });

  it("stops, keeping the reason, when a quote is refused before anything is signed", async () => {
    const r = rig({ quoteErr: (n) => (n === 1 ? new ApiFailure("funds_reserved", 429, "wait") : null) });
    const out = await runPayout(r.deps, run(item(1), item(2)));
    expect([states(out), out.items[0]!.error]).toEqual([["stopped", "todo"], "funds_reserved"]);
    expect(r.sends()).toBe(0);
  });
});

const dir = fileURLToPath(new URL("../../../docs/receipts/", import.meta.url));
const base = readFileRecord("bf28b8ab-31a9-4679-8028-bcb471f7d980", dir)!;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function rec(n: number, o: { taker?: string; recipient?: string | null; out?: string; supersededBy?: string } = {}): ReceiptRecord {
  const bundle = structuredClone(base.bundle);
  bundle.createdAt = `2026-11-2${n}T10:00:00.000Z`;
  bundle.request = { tokenIn: TOKENS.USDT.address, tokenOut: TOKENS.cNGN.address, amountIn: "10000000", taker: o.taker ?? PAYER, ...(o.recipient === null ? {} : { recipient: o.recipient ?? `0x${String(n).padStart(40, "0")}` }) };
  bundle.execution = { ...bundle.execution, amountOut: o.out ?? "14430000000" };
  return { ...base, id: uuid(n), bundle, supersededBy: o.supersededBy ?? null };
}

describe("payout statements", () => {
  it("round-trips receipt ids through the link, and refuses anything else", () => {
    const ids = [uuid(1), "ffffffff-ffff-4fff-bfff-ffffffffffff", "b49c8dd4-d4bc-4f52-aca5-a888ae1237a2"];
    const id = statementId(ids)!;
    expect(id).toMatch(/^[\w-]{22}(\.[\w-]{22}){2}$/);
    expect(parseStatementId(id)).toEqual(ids);
    expect(statementId([])).toBeNull();
    expect(statementId(["nope"])).toBeNull();
    expect(statementId(Array.from({ length: MAX_STATEMENT + 1 }, (_, n) => uuid(n)))).toBeNull();
    for (const bad of ["", "x", "_".repeat(22), `${id}.`, `${id}.${id.split(".")[0]}`, "../../etc/passwd"]) expect(parseStatementId(bad)).toBeNull();
  });

  it("keeps names in the fragment, whatever they contain", () => {
    const names = ["Ada, Lagos", "Lucía #1", "", "100%"];
    expect(parseNames(namesFragment(names))).toEqual(names);
    expect(parseNames("#verificacion")).toEqual([]);
    expect(parseNames("#n=%E0%A4%A")).toEqual([""]);
  });

  it("totals a payer's payments per currency", () => {
    const s = buildStatement([rec(1), rec(2), rec(3, { recipient: `0x${"1".padStart(40, "0")}` })])!;
    expect([s.payer, s.rows.length, s.from.slice(0, 10), s.to.slice(0, 10)]).toEqual([PAYER, 3, "2026-11-21", "2026-11-23"]);
    expect(s.paid.map((p) => [p.token.symbol, p.amount])).toEqual([["USDT", 30_000_000n]]);
    expect(s.received.map((p) => [p.token.symbol, p.amount, p.payees])).toEqual([["cNGN", 43_290_000_000n, 2]]);
  });

  it("never mixes payers, lists a conversion the payer kept, or an undelivered or superseded one", () => {
    expect(buildStatement([rec(1), rec(2, { taker: `0x${"f".repeat(40)}` })])).toBeNull();
    expect(buildStatement([rec(1, { recipient: null })])).toBeNull();
    expect(buildStatement([rec(1, { recipient: PAYER })])).toBeNull();
    expect(buildStatement([rec(1, { out: "0" })])).toBeNull();
    expect(buildStatement([rec(1, { supersededBy: uuid(9) })])).toBeNull();
    expect(buildStatement([])).toBeNull();
  });
});
