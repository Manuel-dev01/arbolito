/**
 * The confirm path for a quote: /prepare (signing Textile's one-time taker proof if asked) →
 * the user's MiniPay sends each call in order → /submit registers the receipt.
 *
 * Money-safety rules encoded here:
 * - Nothing is ever re-sent automatically. A send error that isn't a rejection is "unknown".
 * - Once any tx went out, /submit failures never become "no money moved": the result is "done"
 *   with a registering receipt kept locally for a later re-submit (submit moves no money).
 */
import type { Hex } from "viem";
import type { Call } from "../contract";
import { ApiFailure, type ApiClient, type Prepared, type Submitted } from "./api";
import type { ClientErrorCode } from "./errors";
import { isUserRejection, sendCallsInOrder, signTakerProof, type SendOutcome, type Wallet } from "./wallet";

export type ExecStage =
  | { stage: "preparing" }
  | { stage: "signing-proof" }
  /** Waiting for the user in MiniPay's sheet for call `index` of `total`. */
  | { stage: "confirming"; index: number; total: number }
  /** Call `index` was sent; waiting for its receipt. */
  | { stage: "sent"; index: number; total: number; hash: Hex }
  | { stage: "submitting"; hashes: Hex[] };

export type ExecResult =
  | { kind: "done"; prepared: Prepared | null; hashes: Hex[]; receipt: Submitted | null }
  | { kind: "cancelled" }
  | { kind: "failed"; reason: "reverted" | "unknown"; hashes: Hex[] }
  /** The server refused before anything was sent (expired, price changed, no route…). */
  | { kind: "api-error"; code: ClientErrorCode };

export interface ExecDeps {
  api: ApiClient;
  wallet: Wallet;
  onStage?(s: ExecStage): void;
  /** Delay between /submit retries (ms); tests pass 0. */
  retryDelayMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function prepareWithProof(deps: ExecDeps, quoteId: string): Promise<Prepared> {
  const { api, wallet, onStage } = deps;
  onStage?.({ stage: "preparing" });
  try {
    return await api.prepare({ quoteId, account: wallet.account });
  } catch (e) {
    if (!(e instanceof ApiFailure) || e.code !== "needs_taker_proof" || !e.proof) throw e;
    onStage?.({ stage: "signing-proof" });
    const takerProof = await signTakerProof(wallet.signer, e.proof);
    onStage?.({ stage: "preparing" });
    return api.prepare({ quoteId, account: wallet.account, takerProof });
  }
}

/** Sends calls with stage callbacks; shared by quotes, sends and autonomy plans. */
export async function sendWithStages(deps: ExecDeps, calls: readonly Call[]): Promise<SendOutcome> {
  const total = calls.length;
  const sender = {
    send: (c: Call, i: number) => {
      deps.onStage?.({ stage: "confirming", index: i, total });
      return deps.wallet.sender.send(c, i);
    },
  };
  return sendCallsInOrder(calls, sender, deps.wallet.waiter, {
    onSent: (index, hash) => deps.onStage?.({ stage: "sent", index, total, hash }),
  });
}

export async function submitWithRetry(deps: ExecDeps, quoteId: string, hashes: Hex[], tries = 3): Promise<Submitted | null> {
  for (let i = 0; i < tries; i++) {
    try {
      return await deps.api.submit({ quoteId, account: deps.wallet.account, txHashes: hashes });
    } catch {
      if (i < tries - 1) await sleep((deps.retryDelayMs ?? 1500) * (i + 1));
    }
  }
  return null;
}

function outcomeToResult(o: SendOutcome): ExecResult | null {
  if (o.kind === "cancelled") return { kind: "cancelled" };
  if (o.kind === "failed") return { kind: "failed", reason: o.reason, hashes: o.hashes };
  return null;
}

export async function executeQuote(deps: ExecDeps, quoteId: string): Promise<ExecResult> {
  let prepared: Prepared;
  try {
    prepared = await prepareWithProof(deps, quoteId);
  } catch (e) {
    if (isUserRejection(e)) return { kind: "cancelled" };
    return { kind: "api-error", code: e instanceof ApiFailure ? e.code : "network" };
  }
  const outcome = await sendWithStages(deps, prepared.calls);
  const bad = outcomeToResult(outcome);
  if (bad) return bad;
  deps.onStage?.({ stage: "submitting", hashes: outcome.hashes });
  const receipt = await submitWithRetry(deps, quoteId, outcome.hashes);
  return { kind: "done", prepared, hashes: outcome.hashes, receipt };
}

/** For plans that return calls directly (autonomy on, revoke, send): send them, no /submit. */
export async function executeCalls(deps: ExecDeps, getCalls: () => Promise<{ calls: Call[] }>): Promise<ExecResult> {
  let calls: Call[];
  deps.onStage?.({ stage: "preparing" });
  try {
    calls = (await getCalls()).calls;
  } catch (e) {
    return { kind: "api-error", code: e instanceof ApiFailure ? e.code : "network" };
  }
  const outcome = await sendWithStages(deps, calls);
  const bad = outcomeToResult(outcome);
  if (bad) return bad;
  return { kind: "done", prepared: null, hashes: outcome.hashes, receipt: null };
}
