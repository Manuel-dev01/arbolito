import type { Address } from "viem";
import { z } from "zod";
import type { MiniappDeps } from "./deps";
import { logTextileError } from "./http";
import { loadLiveQuote, type Prepared } from "./prepare";

/**
 * POST /api/miniapp/reject (outside the shared contract; optional for the UI): the wallet declined
 * a prepared call (EIP-1193 code 4001). Marks the quote `failed` with error `rejected_in_minipay`
 * so the Telegram card follows, and releases a firm Textile quote's inventory.
 */
export const RejectRequest = z.object({
  quoteId: z.string().uuid(),
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  /** The wallet's error code, when known (4001 = user rejected). */
  code: z.number().int().optional(),
});
export const RejectResponse = z.object({ quoteId: z.string().uuid(), status: z.string() });

export async function rejectQuote(deps: MiniappDeps, req: z.infer<typeof RejectRequest>): Promise<z.infer<typeof RejectResponse>> {
  const store = deps.store();
  const row = await loadLiveQuote(deps, store, req.quoteId, req.account.toLowerCase() as Address);
  const changed = await store.updateQuote(row.id, { status: "failed", error: "rejected_in_minipay" }, ["quoted", "prepared"]);
  const prepared = row.prepared as Prepared | null;
  if (changed && row.status === "prepared" && prepared?.kind === "textile") {
    await deps.textile.cancel(prepared.rfqId, prepared.claimToken).catch((e: unknown) => logTextileError("reject cancel", e));
  }
  return { quoteId: row.id, status: changed ? "failed" : row.status };
}
