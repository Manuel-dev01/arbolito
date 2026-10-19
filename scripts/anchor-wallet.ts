/**
 * The receipt-anchoring wallet (ANCHOR_PRIVATE_KEY): a gas-only hot wallet that the web app uses
 * to stamp receipts onchain (ArbolitoReceipts.emitReceipt), so they go from "Registrando" to
 * "Verificado". It holds CELO for gas and nothing else.
 *
 *   pnpm anchor:wallet init                     create the key in .env if missing (prints the address only)
 *   pnpm anchor:wallet setup [--fund 0.3]       plan: ops sends CELO for gas, then ops (the owner) adds it as an emitter
 *   pnpm anchor:wallet setup --fork <rpc>       rehearse on an anvil fork
 *   pnpm anchor:wallet setup --live             mainnet (founder go-ahead first)
 *   pnpm anchor:wallet pending [--fork <rpc> | --live]
 *                                               anchor every receipt in the database that is still registering
 *
 * Every tx carries the attribution suffix (sendGuarded). Value moved: the CELO top-up only.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, formatEther, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, findRepoRoot, loadEnv, txUrl } from "@arbolito/config";
import { FileLedger, MemoryLedger, makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { closeDb, getDb, setReceiptAnchorRow, unanchoredReceiptRows } from "@arbolito/db";
import { anchorBundle, bundleHash, proofBundleSchema, receiptsAbi } from "@arbolito/proof";
import { confirm, flagValue, forkUrl, hasFlag, opsAccount, positional, runMain } from "./lib/cli";

/** ~0.01 CELO per anchor at 200 gwei: 0.3 CELO covers ~30 receipts. Top up as usage grows. */
const DEFAULT_FUND = "0.3";
/** CELO is valued at ≤ $1 for the spend caps (it trades well below that). */
const CELO_USD_CEILING_MICROS = 1_000_000n;

runMain(async () => {
  const [cmd] = positional();
  const fork = forkUrl();
  const live = hasFlag("live");
  if (fork && live) throw new Error("Pass either --live or --fork, not both");
  const receiptsAddr = CONTRACTS.arbolitoReceipts as Address | undefined;
  if (!receiptsAddr) throw new Error("ArbolitoReceipts is not configured");

  if (cmd === "init") {
    const env = loadEnv();
    if (env.ANCHOR_PRIVATE_KEY) {
      console.log(`ANCHOR_PRIVATE_KEY already set: ${privateKeyToAccount(env.ANCHOR_PRIVATE_KEY as Hex).address}`);
      return;
    }
    const file = join(findRepoRoot(), ".env");
    if (/^ANCHOR_PRIVATE_KEY=.+$/m.test(readFileSync(file, "utf8"))) throw new Error(".env has an ANCHOR_PRIVATE_KEY line that didn't load; fix it by hand");
    const key = generatePrivateKey();
    appendFileSync(file, `\n# Receipt anchoring hot wallet (gas only), created by scripts/anchor-wallet.ts\nANCHOR_PRIVATE_KEY=${key}\nANCHOR_ENABLED=false\n`);
    console.log(`Created the anchor wallet: ${privateKeyToAccount(key).address} (key written to .env, not printed)`);
    return;
  }
  if (cmd !== "setup" && cmd !== "pending") throw new Error("usage: pnpm anchor:wallet <init|setup|pending> [--fork <rpc> | --live]");

  const env = loadEnv();
  if (!env.ANCHOR_PRIVATE_KEY) throw new Error("Run `pnpm anchor:wallet init` first");
  const anchor = privateKeyToAccount(env.ANCHOR_PRIVATE_KEY as Hex);
  const execute = !!fork || live;
  const mode = fork ? "fork" : "live";
  const clientOpts = fork ? { rpcUrl: fork, pollingInterval: 200 } : {};
  const publicClient = makePublicClient(clientOpts);
  const ledger = fork ? new MemoryLedger() : new FileLedger();
  const where = (h: string) => (fork ? h : txUrl(h));
  const isEmitter = () => publicClient.readContract({ address: receiptsAddr, abi: receiptsAbi, functionName: "isEmitter", args: [anchor.address] });
  console.log(`Anchor wallet ${anchor.address} on ${fork ? `anvil fork ${fork}` : "Celo mainnet"}${execute ? "" : " (PLAN ONLY)"}`);
  console.log(`  CELO ${formatEther(await publicClient.getBalance({ address: anchor.address }))}, emitter: ${await isEmitter()}`);

  if (cmd === "setup") {
    const ops = opsAccount();
    const owner = await publicClient.readContract({ address: receiptsAddr, abi: receiptsAbi, functionName: "owner" });
    if (owner.toLowerCase() !== ops.address.toLowerCase()) throw new Error(`ArbolitoReceipts owner is ${owner}, not the ops wallet ${ops.address}`);
    const fund = parseEther(flagValue("fund") ?? DEFAULT_FUND);
    const has = await publicClient.getBalance({ address: anchor.address });
    const topUp = has >= fund ? 0n : fund - has;
    const emitter = await isEmitter();
    console.log(`Plan:\n  1. ops ${ops.address} sends ${formatEther(topUp)} CELO to the anchor wallet${topUp === 0n ? " (skip: already funded)" : ""}\n  2. ops calls setEmitter(${anchor.address}, true)${emitter ? " (skip: already an emitter)" : ""}`);
    if (!execute) return console.log("\nPlan only. Re-run with --fork <rpc> to rehearse, or --live after the go-ahead.");
    if (live && !(await confirm("\nThis sends 2 transactions from the ops wallet on Celo mainnet.", "send"))) return console.log("Aborted. Nothing was sent.");
    const opsWallet = makeWalletClient(ops, clientOpts);
    if (topUp > 0n) {
      const r = await sendGuarded({ mode, live, publicClient, walletClient: opsWallet, to: anchor.address, value: topUp, data: "0x", usdMicros: (topUp * CELO_USD_CEILING_MICROS) / 10n ** 18n, purpose: "fund anchor wallet (gas)", ledger });
      console.log(`  funded: ${where(r.hash)}`);
    }
    if (!emitter) {
      const data = encodeFunctionData({ abi: receiptsAbi, functionName: "setEmitter", args: [anchor.address, true] });
      const r = await sendGuarded({ mode, live, publicClient, walletClient: opsWallet, to: receiptsAddr, data, usdMicros: 0n, purpose: "allow anchor wallet to emit receipts", ledger });
      console.log(`  emitter set: ${where(r.hash)}`);
    }
    console.log(`After: CELO ${formatEther(await publicClient.getBalance({ address: anchor.address }))}, emitter: ${await isEmitter()}`);
    return;
  }

  // pending: every receipt still registering (and not superseded), oldest first.
  const db = getDb();
  try {
    const rows = await unanchoredReceiptRows(db);
    console.log(`${rows.length} receipt(s) waiting to be anchored`);
    const anchorWallet = makeWalletClient(anchor, clientOpts);
    for (const row of rows) {
      const bundle = proofBundleSchema.parse(row.bundle);
      const h = bundleHash(bundle);
      if (h !== row.bundleHash) {
        console.log(`  ${row.id}: stored hash doesn't match the bundle, skipped`);
        continue;
      }
      const at = await publicClient.readContract({ address: receiptsAddr, abi: receiptsAbi, functionName: "anchoredAt", args: [h] });
      if (at > 0n) {
        const [log] = await publicClient.getContractEvents({ address: receiptsAddr, abi: receiptsAbi, eventName: "ReceiptAnchored", args: { bundleHash: h }, fromBlock: at, toBlock: at });
        console.log(`  ${row.id}: already anchored onchain at block ${at}${live && log ? " (recording it)" : ""}`);
        if (live && log) await setReceiptAnchorRow(db, row.id, log.transactionHash, at);
        continue;
      }
      if (!execute) {
        console.log(`  ${row.id}: would anchor ${h}`);
        continue;
      }
      const a = await anchorBundle({ bundle, receipts: receiptsAddr, mode, live, publicClient, walletClient: anchorWallet, ledger });
      console.log(`  ${row.id}: anchored ${where(a.txHash)}`);
      // Only mainnet anchors are recorded; a fork rehearsal leaves the database untouched.
      if (live) await setReceiptAnchorRow(db, row.id, a.txHash, a.blockNumber);
    }
  } finally {
    await closeDb();
  }
});
