import type { Address, PublicClient } from "viem";
import { verifyBundle, type VerifyResult } from "@arbolito/proof";

/**
 * verifyBundle with a few read-only retries: right after anchoring, a load-balanced RPC
 * (forno) can answer from a node that hasn't seen the anchor or execution tx yet.
 */
export async function verifyWithRetry(json: unknown, o: { client: PublicClient; receipts: Address; emitters?: Address[] }, attempts = 4): Promise<VerifyResult> {
  let last: VerifyResult = { ok: false, errors: ["not run"] };
  for (let i = 1; i <= attempts; i++) {
    try {
      last = await verifyBundle(json, o);
    } catch (err) {
      last = { ok: false, errors: [(err as Error).message] };
    }
    if (last.ok) return last;
    const transient = last.errors.some((e) => /not anchored|not found|no ReceiptAnchored/.test(e));
    if (!transient) return last;
    await new Promise((r) => setTimeout(r, 2_000 * i));
  }
  return last;
}
