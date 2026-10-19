import type { Address } from "viem";
import type { z } from "zod";
import type { ReceiptsListResponse } from "../contract";
import type { MiniappDeps } from "./deps";
import { symOf } from "./quote";

const LIMIT = 50;

/** GET /receipts: this wallet's receipts from the database, so they survive a new phone or a cleared app. */
export async function listReceipts(deps: MiniappDeps, account: Address): Promise<z.infer<typeof ReceiptsListResponse>> {
  const rows = await deps.store().receiptsByTaker(account.toLowerCase(), LIMIT);
  const receipts: z.infer<typeof ReceiptsListResponse>["receipts"] = [];
  for (const r of rows) {
    let from;
    let to;
    try {
      from = symOf(r.tokenIn);
      to = symOf(r.tokenOut);
    } catch {
      continue; // a token the Mini App doesn't show
    }
    const recipient = (r.bundle as { request?: { recipient?: string } } | null)?.request?.recipient ?? null;
    receipts.push({ receiptId: r.id, kind: recipient ? "send" : "change", recipient, at: r.createdAt.toISOString(), from, to, amountIn: r.amountIn, amountOut: r.amountOut });
  }
  return { receipts };
}
