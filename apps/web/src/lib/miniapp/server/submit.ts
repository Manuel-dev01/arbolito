import type { Address, Hex, Transaction, TransactionReceipt } from "viem";
import type { z } from "zod";
import { attributionCodes } from "@arbolito/chain";
import { buildBundle, bundleHash, type ProofBundle } from "@arbolito/proof";
import { receivedInTx, usdMicros, type Quote, type Route } from "@arbolito/router";
import type { SubmitRequest, SubmitResponse } from "../contract";
import type { MiniappDeps } from "./deps";
import { badRequest, notReady, quoteExpired, upstream } from "./errors";
import { logError } from "./http";
import { loadLiveQuote, type Prepared, type PreparedTextile, type StoredCall } from "./prepare";
import { decodePayload } from "./serde";
import type { MiniappStore, ReceiptRow } from "./store";

const eq = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase();

export const receiptUrl = (deps: MiniappDeps, id: string) => `${deps.baseUrl}/r/${id}`;

interface CheckedTx {
  hash: Hex;
  tx: Transaction;
  receipt: TransactionReceipt;
}

/**
 * Verifies one sent tx against the call we prepared: sent by the account, succeeded, same target,
 * same calldata (the prepared core, plus an attribution suffix that includes ATTRIBUTION_CODE).
 */
async function checkTx(deps: MiniappDeps, hash: Hex, call: StoredCall, account: Address, i: number): Promise<CheckedTx> {
  const [tx, receipt] = await Promise.all([
    deps.chain.getTransaction({ hash }).catch(() => null),
    deps.chain.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!tx || !receipt) throw upstream(`Transaction ${i + 1} is not confirmed yet. Try again in a few seconds.`);
  if (!eq(tx.from, account)) throw badRequest(`Transaction ${i + 1} was not sent by this wallet.`);
  if (receipt.status !== "success") throw badRequest(`Transaction ${i + 1} failed onchain.`);
  if (!eq(tx.to, call.to)) throw badRequest(`Transaction ${i + 1} went to a different contract than prepared.`);
  if (tx.value !== BigInt(call.value)) throw badRequest(`Transaction ${i + 1} sent a different value than prepared.`);
  if (!tx.input.toLowerCase().startsWith(call.core.toLowerCase())) throw badRequest(`Transaction ${i + 1} does not carry the prepared data.`);
  if (!deps.attributionCode || !attributionCodes(tx.input).includes(deps.attributionCode)) {
    throw badRequest(`Transaction ${i + 1} is missing the Arbolito attribution tag.`);
  }
  return { hash, tx, receipt };
}

/** The chosen route as executed: taker = the account; a Textile leg carries the firm quote it filled. */
function executedRoute(route: Route, account: Address, prepared: Prepared): Route {
  if (prepared.kind !== "textile") return { ...route, taker: account };
  const leg = route.legs[0]!;
  const buyAmount = BigInt(prepared.buyAmount);
  const firmQuote: Quote = {
    ...leg.quote,
    amountOut: buyAmount,
    firm: true,
    expiresAt: Math.floor(Date.parse(prepared.expiresAt) / 1000),
    raw: { kind: "firm", ...prepared.firm },
  };
  return { ...route, taker: account, legs: [{ quote: firmQuote, minOut: buyAmount }], expectedOut: buyAmount, minOut: buyAmount };
}

/** Report the fill to Textile once. Never retried: on error, read the status and record both. */
async function reportTextile(deps: MiniappDeps, p: PreparedTextile, swapHash: Hex): Promise<PreparedTextile["report"]> {
  try {
    return { status: "submitted", statusAfter: (await deps.textile.submit(p.rfqId, p.claimToken, swapHash)).status };
  } catch (err) {
    logError("submit textile report", err);
    const statusAfter = await deps.textile
      .status(p.rfqId, p.claimToken)
      .then((s) => s.status)
      .catch(() => "unknown");
    return { status: "submit_failed", statusAfter, error: err instanceof Error ? err.name : "error" };
  }
}

async function existingResponse(deps: MiniappDeps, row: ReceiptRow): Promise<z.infer<typeof SubmitResponse>> {
  return { receiptId: row.id, status: row.anchorTx ? "verified" : "registering", url: receiptUrl(deps, row.id) };
}

/** Anchors the bundle when enabled (ANCHOR_ENABLED + ANCHOR_PRIVATE_KEY). Returns whether it anchored. */
export async function maybeAnchor(deps: MiniappDeps, store: MiniappStore, bundle: ProofBundle): Promise<boolean> {
  if (!deps.anchor) return false;
  try {
    const a = await deps.anchor(bundle);
    await store.setReceiptAnchor(bundle.routeId, a.txHash, a.blockNumber);
    return true;
  } catch (err) {
    // Left registering; the hash can be anchored later (scripts/reanchor-receipt.ts).
    logError("anchor", err);
    return false;
  }
}

/** POST /submit: verify the user's txs onchain, register the receipt, anchor if enabled. */
export async function submitQuote(deps: MiniappDeps, req: z.infer<typeof SubmitRequest>): Promise<z.infer<typeof SubmitResponse>> {
  const account = req.account.toLowerCase() as Address;
  const store = deps.store();
  const row = await loadLiveQuote(deps, store, req.quoteId, account);
  if (row.status === "submitted" && row.receiptId) {
    const existing = await store.getReceipt(row.receiptId);
    if (existing) return existingResponse(deps, existing);
  }
  if (row.status === "quoted") throw badRequest("Prepare this quote before submitting.", 409);
  if (row.status !== "prepared" && row.status !== "submitted") throw quoteExpired();
  const prepared = row.prepared as Prepared | null;
  if (!prepared) throw badRequest("Prepare this quote before submitting.", 409);
  if (!deps.attributionCode) throw notReady("ATTRIBUTION_CODE is not configured.");

  const hashes = req.txHashes.map((h) => h.toLowerCase() as Hex);
  if (hashes.some((h) => !/^0x[0-9a-f]{64}$/.test(h))) throw badRequest("txHashes must be 32-byte hashes.");
  if (new Set(hashes).size !== hashes.length) throw badRequest("txHashes repeat.");
  if (hashes.length !== prepared.calls.length) throw badRequest(`Expected ${prepared.calls.length} transaction(s), got ${hashes.length}.`);
  const checked: CheckedTx[] = [];
  for (const [i, h] of hashes.entries()) checked.push(await checkTx(deps, h, prepared.calls[i]!, account, i));
  const swap = checked[checked.length - 1]!;

  // A concurrent or repeated submit for the same swap returns the receipt already registered.
  const dup = await store.receiptByExecutionTx(swap.hash);
  if (dup) return existingResponse(deps, dup);

  const payload = decodePayload(row.payload);
  const route = executedRoute(payload.route, account, prepared);
  // Authoritative executed amount: the swap's Transfer logs to the account (never balance diffs).
  const amountOut = receivedInTx(swap.receipt, route.tokenOut, account);

  let report: PreparedTextile["report"];
  if (prepared.kind === "textile") report = await reportTextile(deps, prepared, swap.hash);

  const bundle = buildBundle({
    route,
    alternatives: payload.alternatives,
    quotesConsidered: payload.quotesConsidered,
    references: payload.references,
    execution: { txHash: swap.hash, blockNumber: swap.receipt.blockNumber, amountOut, attribution: attributionCodes(swap.tx.input) },
    createdAt: new Date(deps.now()),
  });
  let usd = 0n;
  try {
    usd = await usdMicros(deps.chain, route.tokenIn, route.amountIn, swap.receipt.blockNumber);
  } catch (err) {
    logError("submit usd value", err);
  }

  const user = await store.walletUser(account);
  const inserted = await store.insertReceipt({
    id: bundle.routeId,
    userId: user.id,
    bundleHash: bundleHash(bundle),
    bundle,
    tokenIn: route.tokenIn,
    tokenOut: route.tokenOut,
    amountIn: route.amountIn.toString(),
    amountOut: amountOut.toString(),
    usdMicros: usd.toString(),
    taker: account,
    executionTx: swap.hash,
    executionBlock: swap.receipt.blockNumber,
    savingsBps: bundle.savings ? Math.trunc(bundle.savings.bps) : null,
  });
  if (!inserted) {
    const again = (await store.receiptByExecutionTx(swap.hash)) ?? (await store.getReceipt(bundle.routeId));
    if (again) return existingResponse(deps, again);
    throw upstream("Could not register the receipt. Your conversion is onchain; try again.");
  }
  await store.updateQuote(row.id, {
    status: "submitted",
    receiptId: bundle.routeId,
    ...(prepared.kind === "textile" ? { prepared: { ...prepared, report } } : {}),
  });

  const anchored = await maybeAnchor(deps, store, bundle);
  return { receiptId: bundle.routeId, status: anchored ? "verified" : "registering", url: receiptUrl(deps, bundle.routeId) };
}
