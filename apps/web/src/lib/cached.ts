import { unstable_cache } from "next/cache";
import type { Hex } from "viem";
import type { ProofBundle } from "@arbolito/proof";
import { findAnchor, verifyOnchain, type Verification } from "./chain";
import { getReceipt, listReceipts, type ReceiptRecord } from "./data";

/**
 * Next data-cache wrappers (server only). Receipts and metrics refresh every ~60 s; onchain
 * verification of an immutable bundle is cached for an hour. A thrown error is never cached,
 * so an RPC hiccup only costs one render.
 */

export const getReceiptCached = unstable_cache(async (id: string): Promise<ReceiptRecord | null> => (await getReceipt(id)) ?? null, ["receipt-v1"], {
  revalidate: 60,
  tags: ["receipts"],
});

export const listReceiptsCached = unstable_cache(
  async (): Promise<{ records: ReceiptRecord[]; fetchedAt: string }> => ({ records: await listReceipts(), fetchedAt: new Date().toISOString() }),
  ["receipts-list-v1"],
  { revalidate: 60, tags: ["receipts"] },
);

/** Thrown inside the cache so a failed check is returned but never cached. */
class NotVerified extends Error {
  constructor(readonly result: Verification) {
    super("not verified");
  }
}

// Only a passing check is cached (an hour). A failure (not anchored yet, a lagging node) is
// re-checked on the next view, so a receipt anchored late never shows "mismatch" from the cache.
const verifyCached = unstable_cache(
  async (_hash: string, bundle: ProofBundle) => {
    const r = await verifyOnchain(bundle);
    if (!r.ok) throw new NotVerified(r);
    return r;
  },
  ["verify-v2"],
  { revalidate: 3600 },
);

/** Verification, or the error message if the chain could not be reached right now. */
export async function verifyReceipt(hash: string, bundle: ProofBundle): Promise<{ result?: Verification; error?: string }> {
  try {
    return { result: await withTimeout(verifyCached(hash, bundle), 12_000) };
  } catch (e) {
    if (e instanceof NotVerified) return { result: e.result };
    return { error: e instanceof Error ? e.message.slice(0, 200) : "unknown error" };
  }
}

const anchorCached = unstable_cache(async (hash: string) => findAnchor(hash as Hex), ["anchor-v1"], { revalidate: 3600 });

/** Anchor tx for receipts that do not carry one (file fallback); null when unknown or unreachable. */
export async function anchorFor(rec: ReceiptRecord, hash: string): Promise<{ txHash: string; blockNumber: string } | null> {
  if (rec.anchorTx) return { txHash: rec.anchorTx, blockNumber: rec.anchorBlock ?? "" };
  try {
    return await withTimeout(anchorCached(hash), 8_000);
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
