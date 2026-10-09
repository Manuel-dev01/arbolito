/**
 * pnpm smoke:convert <from> <to> <amount> [--live | --fork <rpc> --receipts <addr>] [--fee-currency USDT] [--yes]
 * e.g. pnpm smoke:convert wBRL wARS 10 --live
 *
 * The Phase 1 mainnet smoke: quote → show route + USD value → typed confirmation →
 * approve + swap via sendGuarded → build ProofBundle → anchor → verify → save JSON.
 * - no flag:  stops after the quote and cap check (no transaction)
 * - --live:   Celo mainnet. Founder go-ahead required. Caps from .env are enforced before signing.
 * - --fork:   the exact same path against an anvil fork (rehearsal; in-memory ledger)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import { CONTRACTS, findRepoRoot, tokenBySymbol, txUrl } from "@arbolito/config";
import {
  FileLedger,
  MemoryLedger,
  attributionCodes,
  capsFromEnv,
  checkCaps,
  formatUsd,
  makePublicClient,
  makeWalletClient,
  sendGuarded,
  utcDay,
} from "@arbolito/chain";
import {
  TextileRfqAdapter,
  UniswapV3Adapter,
  buildRouteCalls,
  erc20Abi,
  fetchReferences,
  fmtAmount,
  plan,
  toAtomic,
  usdMicros,
} from "@arbolito/router";
import { anchorBundle, buildBundle, bundleHash, verifyBundle } from "@arbolito/proof";
import { jsonStringify } from "./lib/json";
import { confirm, flagValue, forkUrl, hasFlag, opsAccount, positional, runMain } from "./lib/cli";

runMain(async () => {
  const [fromArg, toArg, amountArg] = positional();
  if (!fromArg || !toArg || !amountArg) throw new Error("usage: pnpm smoke:convert <from> <to> <amount> [--live | --fork <rpc>]");
  const fork = forkUrl();
  const live = hasFlag("live");
  if (fork && live) throw new Error("Pass either --live or --fork, not both");
  const mode = fork ? "fork" : "live";
  const execute = fork ? true : live;
  const feeCurrency = flagValue("fee-currency");
  const receipts = (flagValue("receipts") as Address | undefined) ?? CONTRACTS.arbolitoReceipts;
  if (execute && !receipts) throw new Error("ArbolitoReceipts address unknown (deploy it first, or pass --receipts)");

  const account = opsAccount();
  const clientOpts = fork ? { rpcUrl: fork, pollingInterval: 200 } : {};
  const publicClient = makePublicClient(clientOpts);
  const walletClient = makeWalletClient(account, clientOpts);
  const ledger = fork ? new MemoryLedger() : new FileLedger();
  const from = tokenBySymbol(fromArg);
  const to = tokenBySymbol(toArg);
  const amountIn = toAtomic(from.address, amountArg);

  const balance = await publicClient.readContract({ address: from.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  if (balance < amountIn) throw new Error(`Wallet ${account.address} holds ${fmtAmount(from.address, balance)}, needs ${fmtAmount(from.address, amountIn)}`);

  const planned = await plan({
    client: publicClient,
    adapters: [new UniswapV3Adapter(publicClient), new TextileRfqAdapter()],
    tokenIn: from.address,
    tokenOut: to.address,
    amountIn,
    taker: account.address,
  });
  if (!planned.best) throw new Error("No route available right now");
  const route = planned.best;
  const value = await usdMicros(publicClient, from.address, amountIn, planned.blockNumber);

  // Cap pre-check, so a refusal shows before anyone is asked to confirm.
  checkCaps(value, ledger.spent(utcDay(new Date())), capsFromEnv());

  console.log(`Smoke convert on ${fork ? `anvil fork ${fork}` : "Celo mainnet"} (block ${planned.blockNumber})
  from          ${account.address}
  sell          ${fmtAmount(from.address, amountIn)}  (~${formatUsd(value)})
  route         ${route.label}
  expected      ${fmtAmount(to.address, route.expectedOut)}
  min out       ${fmtAmount(to.address, route.minOut)}
  alternatives  ${planned.alternatives.length}
  gas paid in   ${feeCurrency ?? "CELO"}`);

  if (!execute) {
    console.log("\nDry run only. Re-run with --live after the founder approves (or --fork to rehearse).");
    return;
  }
  const what = fork ? "This swaps on the anvil fork" : "This swaps real funds on Celo mainnet";
  if (!(await confirm(`\n${what}, then anchors a receipt.`))) {
    console.log("Aborted. Nothing was sent.");
    return;
  }

  const calls = buildRouteCalls(route, account.address);
  const before = await publicClient.readContract({ address: to.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  let swapHash: `0x${string}` | undefined;
  for (const [i, call] of calls.entries()) {
    const isSwap = i === calls.length - 1; // approve first, swap last
    const { hash } = await sendGuarded({
      mode,
      live: !fork,
      publicClient,
      walletClient,
      to: call.to,
      data: call.data,
      usdMicros: isSwap ? value : 0n,
      purpose: call.label,
      feeCurrency,
      ledger,
    });
    console.log(`  ${call.label}: ${fork ? hash : txUrl(hash)}`);
    if (isSwap) swapHash = hash;
  }
  const after = await publicClient.readContract({ address: to.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const swapReceipt = await publicClient.getTransactionReceipt({ hash: swapHash! });
  const swapTx = await publicClient.getTransaction({ hash: swapHash! });

  const refs = await fetchReferences(publicClient, planned.blockNumber);
  const bundle = buildBundle({
    route,
    alternatives: planned.alternatives,
    quotesConsidered: planned.quotesConsidered,
    references: refs.references,
    execution: { txHash: swapHash!, blockNumber: swapReceipt.blockNumber, amountOut: after - before, attribution: attributionCodes(swapTx.input) },
  });

  // The swap already settled; the receipt is bookkeeping. Save the bundle before anchoring
  // so a failed anchor never loses it (and is never blindly retried).
  const dir = fork ? join(findRepoRoot(), ".arbolito", "receipts") : join(findRepoRoot(), "docs", "receipts");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${bundle.routeId}.json`);
  writeFileSync(file, jsonStringify(bundle));
  console.log(`  bundle saved: ${file}\n  bundle hash:  ${bundleHash(bundle)}`);

  const anchored = await anchorBundle({ bundle, receipts: receipts!, mode, live: !fork, publicClient, walletClient, feeCurrency });
  console.log(`  receipt anchored: ${fork ? anchored.txHash : txUrl(anchored.txHash)}`);

  const verified = await verifyBundle(JSON.parse(jsonStringify(bundle)), { client: publicClient, receipts: receipts!, emitters: [account.address] });
  console.log(`\nverifyBundle: ${verified.ok ? "OK" : `FAILED: ${verified.errors.join("; ")}`}`);
  console.log(`received ${fmtAmount(to.address, after - before)} (expected ${fmtAmount(to.address, route.expectedOut)})`);
  console.log(`savings vs official: ${bundle.savings ? `${bundle.savings.bps} bps (${bundle.savings.pair})` : "n/a"}`);
});
