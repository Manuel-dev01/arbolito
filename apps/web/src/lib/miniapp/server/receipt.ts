import type { z } from "zod";
import { proofBundleSchema } from "@arbolito/proof";
import type { ReceiptResponse, ReceiptStatus } from "../contract";
import type { MiniappDeps } from "./deps";
import { badRequest, notFound } from "./errors";
import { logError } from "./http";
import { symOf } from "./quote";
import { maybeAnchor, receiptUrl } from "./submit";
import { vsWesternUnion } from "./competitors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Self-healing anchors: a receipt still registering this long after it was saved gets its anchor
 * retried when someone looks at it, at most once a minute per receipt (per server instance). The
 * contract rejects a duplicate fingerprint and the send is simulated first, so a concurrent retry
 * costs nothing. Before this, a failed anchor stayed "registering" until someone ran the backfill.
 */
export const HEAL_AFTER_MS = 15_000;
const HEAL_EVERY_MS = 60_000;
const lastHeal = new Map<string, number>();

/**
 * GET /receipt/:id. verified = anchored and verifyBundle passes; registering = not anchored yet
 * (or the chain could not be read just now); mismatch = anchored but verification fails.
 */
export async function getMiniappReceipt(deps: MiniappDeps, id: string): Promise<z.infer<typeof ReceiptResponse>> {
  if (!UUID.test(id)) throw badRequest("Not a receipt id.");
  const row = await deps.store().getReceipt(id.toLowerCase());
  if (!row) throw notFound("Receipt not found.");
  const parsed = proofBundleSchema.safeParse(row.bundle);
  if (!parsed.success) throw notFound("Receipt bundle is unreadable.");
  const bundle = parsed.data;

  let anchorTx = row.anchorTx ?? null;
  const store = deps.store();
  if (!anchorTx && deps.anchor) {
    const age = deps.now() - (row.createdAt ? row.createdAt.getTime() : Date.parse(bundle.createdAt));
    const last = lastHeal.get(row.id) ?? 0;
    if (age >= HEAL_AFTER_MS && deps.now() - last >= HEAL_EVERY_MS) {
      lastHeal.set(row.id, deps.now());
      if (await maybeAnchor(deps, store, bundle)) anchorTx = (await store.getReceipt(row.id))?.anchorTx ?? null;
    }
  }

  let status: z.infer<typeof ReceiptStatus> = "registering";
  if (anchorTx) {
    try {
      status = (await deps.verify(bundle)).ok ? "verified" : "mismatch";
    } catch (err) {
      logError("receipt verify", err);
      status = "registering";
    }
  }
  const s = bundle.savings;
  return {
    receiptId: row.id,
    status,
    url: receiptUrl(deps, row.id),
    from: symOf(row.tokenIn),
    to: symOf(row.tokenOut),
    amountIn: row.amountIn,
    amountOut: row.amountOut,
    savings: s ? { pct: s.bps / 100, deltaOut: s.delta, pair: s.pair } : null,
    vsWesternUnion: vsWesternUnion(symOf(row.tokenIn), symOf(row.tokenOut), BigInt(row.amountIn), BigInt(row.amountOut), bundle.references),
    executionTx: row.executionTx,
    anchorTx,
    createdAt: (row.createdAt ?? new Date(bundle.createdAt)).toISOString(),
  };
}
