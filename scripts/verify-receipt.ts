/**
 * pnpm verify:receipt <bundle.json> [more.json …]
 * Independently verifies published ProofBundles against Celo mainnet: recomputes the canonical
 * JSON hash, finds its ReceiptAnchored event, and checks the execution tx (success, block,
 * attribution, delivered amount). Read-only.
 */
import { readFileSync } from "node:fs";
import { CONTRACTS, txUrl } from "@arbolito/config";
import { makePublicClient } from "@arbolito/chain";
import { bundleHash, proofBundleSchema } from "@arbolito/proof";
import { positional, runMain } from "./lib/cli";
import { verifyWithRetry } from "./lib/verify";

runMain(async () => {
  const files = positional();
  if (!files.length) throw new Error("usage: pnpm verify:receipt <bundle.json> [more.json …]");
  const receipts = CONTRACTS.arbolitoReceipts;
  if (!receipts) throw new Error("ArbolitoReceipts is not configured");
  const client = makePublicClient();
  let failures = 0;
  for (const f of files) {
    const json: unknown = JSON.parse(readFileSync(f, "utf8"));
    const parsed = proofBundleSchema.safeParse(json);
    const r = await verifyWithRetry(json, { client, receipts }, 2);
    console.log(`${r.ok ? "OK  " : "FAIL"} ${f}`);
    if (parsed.success) console.log(`     hash ${bundleHash(parsed.data)}  execution ${txUrl(parsed.data.execution.txHash)}`);
    if (r.anchor) console.log(`     anchored ${txUrl(r.anchor.txHash)} by ${r.anchor.emitter}`);
    for (const e of r.errors) console.log(`     - ${e}`);
    if (!r.ok) failures++;
  }
  if (failures) throw new Error(`${failures} of ${files.length} bundle(s) failed verification`);
});
