/**
 * pnpm reanchor:receipt <routeId> [--live] [--yes]
 *
 * Corrects a saved ProofBundle whose execution.amountOut disagrees with what the execution
 * tx actually delivered (from its Transfer logs), then anchors the corrected bundle.
 * The flawed bundle is kept as <routeId>.superseded.json; its onchain anchor stays, and it now
 * fails verifyBundle, which is the honest outcome. Gas only ($0 value). Founder go-ahead for --live.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { CONTRACTS, findRepoRoot, txUrl } from "@arbolito/config";
import { attributionCodes, makePublicClient, makeWalletClient } from "@arbolito/chain";
import { receivedInTx } from "@arbolito/router";
import { anchorBundle, bundleHash, proofBundleSchema } from "@arbolito/proof";
import { confirm, hasFlag, opsAccount, positional, runMain } from "./lib/cli";
import { jsonStringify } from "./lib/json";
import { verifyWithRetry } from "./lib/verify";

runMain(async () => {
  const [routeId] = positional();
  if (!routeId) throw new Error("usage: pnpm reanchor:receipt <routeId> [--live]");
  const receipts = CONTRACTS.arbolitoReceipts;
  if (!receipts) throw new Error("ArbolitoReceipts is not configured");
  const dir = join(findRepoRoot(), "docs", "receipts");
  const file = join(dir, `${routeId}.json`);
  if (!existsSync(file)) throw new Error(`No saved bundle at ${file}`);
  const original = proofBundleSchema.parse(JSON.parse(readFileSync(file, "utf8")));

  const client = makePublicClient();
  const txHash = original.execution.txHash as Hex;
  const [execReceipt, execTx] = await Promise.all([client.getTransactionReceipt({ hash: txHash }), client.getTransaction({ hash: txHash })]);
  const delivered = receivedInTx(execReceipt, original.request.tokenOut as Hex, original.request.taker as Hex);
  console.log(`execution ${txUrl(txHash)}
  bundle amountOut   ${original.execution.amountOut}
  delivered onchain  ${delivered}`);
  if (delivered.toString() === original.execution.amountOut) {
    console.log("Bundle already matches the chain. Nothing to correct.");
    return;
  }

  const corrected = proofBundleSchema.parse({
    ...original,
    execution: { ...original.execution, amountOut: delivered.toString(), attribution: attributionCodes(execTx.input) },
  });
  console.log(`  original hash      ${bundleHash(original)}\n  corrected hash     ${bundleHash(corrected)}`);
  if (!hasFlag("live")) {
    console.log("\nDry run only. Re-run with --live to anchor the corrected bundle.");
    return;
  }
  if (!(await confirm("\nThis anchors the corrected receipt on Celo mainnet (gas only).", "anchor"))) {
    console.log("Aborted. Nothing was sent.");
    return;
  }

  renameSync(file, join(dir, `${routeId}.superseded.json`));
  writeFileSync(file, jsonStringify(corrected));
  const account = opsAccount();
  const anchored = await anchorBundle({ bundle: corrected, receipts, mode: "live", live: true, publicClient: client, walletClient: makeWalletClient(account) });
  console.log(`  corrected receipt anchored: ${txUrl(anchored.txHash)}`);

  const v = await verifyWithRetry(JSON.parse(jsonStringify(corrected)), { client, receipts, emitters: [account.address] });
  console.log(`\nverifyBundle (corrected): ${v.ok ? "OK" : `FAILED: ${v.errors.join("; ")}`}`);
  const old = await verifyWithRetry(JSON.parse(jsonStringify(original)), { client, receipts }, 1);
  console.log(`verifyBundle (superseded): ${old.ok ? "OK (unexpected)" : `fails as expected: ${old.errors.join("; ")}`}`);
});
