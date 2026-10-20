import type { z } from "zod";
import { proofBundleSchema } from "@arbolito/proof";
import type { ReceiptResponse, ReceiptStatus } from "../contract";
import type { MiniappDeps } from "./deps";
import { badRequest, notFound } from "./errors";
import { logError } from "./http";
import { symOf } from "./quote";
import { receiptUrl } from "./submit";
import { vsWesternUnion } from "./competitors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  let status: z.infer<typeof ReceiptStatus> = "registering";
  if (row.anchorTx) {
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
    anchorTx: row.anchorTx ?? null,
    createdAt: (row.createdAt ?? new Date(bundle.createdAt)).toISOString(),
  };
}
