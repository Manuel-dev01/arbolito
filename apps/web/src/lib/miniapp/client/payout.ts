/**
 * Batch payouts: one review, then each payee is paid on their own (a fresh quote, their own fill and
 * forward, their own receipt), so one payee's trouble never touches another's payment.
 *
 * Money-safety rules encoded here:
 * - Progress is saved before each wallet confirmation. A payment found mid-flight on the next open is
 *   "unknown", and an unknown payment is never retried: the chain or the payer says what happened.
 * - A payee is held, unsigned, when the fresh price is more than the tolerance under the reviewed one.
 * - The run stops at the first cancel, failure or doubt; what was paid stays paid.
 */
import type { Hex } from "viem";
import type { Sym } from "../contract";
import { ApiFailure } from "./api";
import { executeCalls, prepareSendWithProof, submitWithRetry, type ExecDeps, type ExecStage } from "./execute";
import type { ClientErrorCode } from "./errors";
import { DECIMALS, parseHuman } from "./format";

/** What the payer accepts between the review and each payment: 0.5%. */
export const PAYOUT_TOLERANCE_BPS = 50n;
export const MAX_PAYEES = 20;

export type PayoutItemState =
  | "todo"
  /** A wallet confirmation was opened for it. */
  | "sending"
  | "paid"
  /** The price fell past the tolerance: nothing was signed. */
  | "held"
  /** Declined or refused before any money moved: can be tried again. */
  | "stopped"
  /** Changed to local currency but not delivered: it sits in the payer's account. */
  | "converted"
  /** It may have gone out: never retried on its own. */
  | "unknown";

export interface PayoutItem {
  contactId: string;
  name: string;
  address: string;
  from: Sym;
  to: Sym;
  /** Human units of `from` ("25" or "12.5"). */
  amount: string;
  /** What the payee gets at the reviewed price (atomic). */
  reviewedOut: string;
  /** On a held payment, what they would get now. */
  heldOut?: string;
  state: PayoutItemState;
  error?: ClientErrorCode;
  quoteId?: string;
  /** How many calls the prepared payment had, and the ones that were sent. */
  calls?: number;
  hashes?: Hex[];
  paidOut?: string;
  receiptId?: string;
}

export interface PayoutRun {
  id: string;
  at: string;
  items: PayoutItem[];
}

export interface PayoutDeps extends Omit<ExecDeps, "onStage"> {
  lang: string;
  /** Persists the run; called before every wallet confirmation and after every outcome. */
  save(run: PayoutRun): void;
  onStage?(index: number, s: ExecStage): void;
}

const codeOf = (e: unknown): ClientErrorCode => (e instanceof ApiFailure ? e.code : "network");

export const isUnderTolerance = (reviewed: bigint, now: bigint) => now * 10_000n < reviewed * (10_000n - PAYOUT_TOLERANCE_BPS);

/** States a run picks up again. Held ones need a new review first. */
const open = (s: PayoutItemState) => s === "todo" || s === "stopped";

/** A run loaded from the phone: a payment that was mid-flight is of unknown outcome. */
export function restoreRun(run: PayoutRun): PayoutRun {
  return { ...run, items: run.items.map((i) => (i.state === "sending" ? { ...i, state: "unknown" } : i)) };
}

/** What's left to pay from payment `i` on in its currency: one approval covers it (the venue, and so the spender, goes with the currency). */
export const leftInCurrency = (items: readonly PayoutItem[], i: number): bigint =>
  items.slice(i).reduce((n, x) => (open(x.state) && x.from === items[i]!.from && x.to === items[i]!.to ? n + parseHuman(x.amount, DECIMALS[x.from]) : n), 0n);

export const runFinished = (run: PayoutRun) => run.items.every((i) => i.state === "paid");
export const canContinue = (run: PayoutRun) => run.items.some((i) => open(i.state));

/** Pays every open item in order, returning the updated run. Never re-sends anything. */
export async function runPayout(deps: PayoutDeps, start: PayoutRun): Promise<PayoutRun> {
  let run = start;
  const patch = (i: number, p: Partial<PayoutItem>) => {
    run = { ...run, items: run.items.map((x, n) => (n === i ? { ...x, ...p } : x)) };
    deps.save(run);
  };

  for (let i = 0; i < run.items.length; i++) {
    const item = run.items[i]!;
    if (!open(item.state)) continue;
    const account = deps.wallet.account;
    const reviewed = BigInt(item.reviewedOut);

    let quoteId: string;
    try {
      deps.onStage?.(i, { stage: "preparing" });
      const q = await deps.api.quote({ from: item.from, to: item.to, amount: item.amount, account, lang: deps.lang as never });
      quoteId = q.quoteId;
      if (isUnderTolerance(reviewed, BigInt(q.expectedOut))) {
        patch(i, { state: "held", heldOut: q.expectedOut, error: undefined });
        continue;
      }
    } catch (e) {
      patch(i, { state: "stopped", error: codeOf(e) });
      return run;
    }

    let held: string | null = null;
    const approveUpTo = leftInCurrency(run.items, i).toString();
    let total = 0;
    let out = "0";
    const sent: Hex[] = [];
    const exec: ExecDeps = {
      ...deps,
      onStage: (s) => {
        // Saved before the sheet opens: if the app dies now, this payment is never blindly repeated.
        if (s.stage === "confirming") patch(i, { state: "sending", quoteId, calls: s.total, hashes: [...sent], error: undefined });
        if (s.stage === "sent") {
          sent.push(s.hash);
          patch(i, { hashes: [...sent] });
        }
        deps.onStage?.(i, s);
      },
    };
    const res = await executeCalls(exec, async () => {
      const p = await prepareSendWithProof(exec, { account, recipient: item.address as Hex, from: item.from, to: item.to, amount: item.amount, quoteId, approveUpTo });
      if (isUnderTolerance(reviewed, BigInt(p.expectedOut))) {
        held = p.expectedOut;
        throw new Error("held");
      }
      total = p.calls.length;
      out = p.expectedOut;
      return p;
    });

    if (held !== null) {
      // Nothing was signed: release the firm quote.
      deps.api.reject({ quoteId, account }).catch(() => {});
      patch(i, { state: "held", heldOut: held, error: undefined });
      continue;
    }
    if (res.kind === "done") {
      patch(i, { state: "paid", paidOut: out, calls: total, hashes: res.hashes, error: undefined });
      const receipt = await submitWithRetry(exec, quoteId, res.hashes);
      if (receipt) patch(i, { receiptId: receipt.receiptId });
      continue;
    }
    if (res.kind === "api-error") {
      patch(i, { state: "stopped", error: res.code });
      return run;
    }
    if (res.kind === "failed" && res.reason === "unknown") patch(i, { state: "unknown", hashes: res.hashes });
    else if (res.converted) patch(i, { state: "converted" });
    else {
      if (res.kind === "cancelled") deps.api.reject({ quoteId, account, code: 4001 }).catch(() => {});
      patch(i, { state: "stopped", error: undefined });
    }
    return run;
  }
  return run;
}

/**
 * Looks up what onchain evidence there is for payments without a receipt: registering moves no money
 * and the server checks every transaction, so this can settle an "unknown" one as paid.
 */
export async function settleReceipts(deps: PayoutDeps, start: PayoutRun): Promise<PayoutRun> {
  let run = start;
  for (let i = 0; i < run.items.length; i++) {
    const x = run.items[i]!;
    if (x.receiptId || !x.quoteId || !x.hashes?.length || x.hashes.length !== x.calls) continue;
    if (x.state !== "paid" && x.state !== "unknown") continue;
    const receipt = await submitWithRetry({ ...deps, onStage: undefined }, x.quoteId, x.hashes, 1);
    if (!receipt) continue;
    run = { ...run, items: run.items.map((y, n) => (n === i ? { ...y, state: "paid", receiptId: receipt.receiptId } : y)) };
    deps.save(run);
  }
  return run;
}
