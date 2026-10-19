/**
 * pnpm deploy:guard [--live | --fork <rpc>] [--yes]
 * Deploys ArbolitoGuard v2 (contracts/src/ArbolitoGuard.sol) from OPS_PRIVATE_KEY. The guard is
 * ownerless and immutable: its constructor pins SwapRouter02, the v3 factory, a 10-minute TWAP,
 * the five tokens and the 0.01% pools (guardV2ConstructorArgs).
 *
 * Also creates the operator key (ARBOLITO_OPERATOR_PRIVATE_KEY in .env) if it is missing and
 * prints its address only. The operator holds gas and nothing else; it can act only for accounts
 * that set it as their operator, within the caps they configured.
 *
 * - no flag:  the plan and a gas estimate (no transaction)
 * - --fork:   the same deploy on an anvil fork (rehearsal)
 * - --live:   Celo mainnet (founder go-ahead first); attribution appended
 */
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { encodeDeployData, formatEther, formatGwei, getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { addressUrl, findRepoRoot, loadEnv, txUrl } from "@arbolito/config";
import { FORK_ATTRIBUTION_CODE, arbolitoGuardAbi, guardV2ConstructorArgs, makePublicClient, makeWalletClient, sendGuarded, withAttribution } from "@arbolito/chain";
import { confirm, forkUrl, hasFlag, opsAccount, runMain } from "./lib/cli";

function guardBytecode(): Hex {
  const path = join(findRepoRoot(), "contracts", "out", "ArbolitoGuard.sol", "ArbolitoGuard.json");
  return (JSON.parse(readFileSync(path, "utf8")) as { bytecode: { object: Hex } }).bytecode.object;
}

function ensureOperatorKey(): `0x${string}` {
  const env = loadEnv();
  if (env.ARBOLITO_OPERATOR_PRIVATE_KEY) return privateKeyToAccount(env.ARBOLITO_OPERATOR_PRIVATE_KEY as Hex).address;
  const file = join(findRepoRoot(), ".env");
  if (/^ARBOLITO_OPERATOR_PRIVATE_KEY=.+$/m.test(readFileSync(file, "utf8"))) throw new Error(".env has an ARBOLITO_OPERATOR_PRIVATE_KEY line that didn't load; fix it by hand");
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  appendFileSync(file, `\n# ArbolitoGuard operator (gas only), created by scripts/deploy-guard.ts\nARBOLITO_OPERATOR_PRIVATE_KEY=${key}\n`);
  console.log(`Created the operator key (written to .env, not printed): ${address}`);
  return address;
}

runMain(async () => {
  const fork = forkUrl();
  const live = hasFlag("live");
  if (fork && live) throw new Error("Pass either --live or --fork, not both");
  const env = loadEnv();
  const account = opsAccount();
  const clientOpts = fork ? { rpcUrl: fork, pollingInterval: 200 } : {};
  const publicClient = makePublicClient(clientOpts);
  const args = guardV2ConstructorArgs();
  const data = encodeDeployData({ abi: arbolitoGuardAbi, bytecode: guardBytecode(), args });
  const operator = ensureOperatorKey();

  const [celo, gas, gasPrice, block, tip] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.estimateGas({ account, data: withAttribution(data, env.ATTRIBUTION_CODE ?? FORK_ATTRIBUTION_CODE) }),
    publicClient.getGasPrice(),
    publicClient.getBlock(),
    publicClient.estimateMaxPriorityFeePerGas(),
  ]);
  // A 25% base-fee cap (Celo's base fee moves slowly) instead of viem's ~2x, so a ~3M-gas deploy fits the ops float.
  const fees = { maxFeePerGas: ((block.baseFeePerGas ?? gasPrice) * 5n) / 4n + tip, maxPriorityFeePerGas: tip };
  console.log(`Deploy ArbolitoGuard v2 to ${fork ? `anvil fork ${fork}` : "Celo mainnet"}
  from             ${account.address} (CELO ${formatEther(celo)})
  gas estimate     ${gas} at ${formatGwei(gasPrice)} gwei ≈ ${formatEther(gas * gasPrice)} CELO (worst case ${formatEther(gas * fees.maxFeePerGas)})
  swapRouter       ${args[0]}
  factory          ${args[1]}
  twap window      ${args[2]} s
  tokens           ${args[3].join(", ")}
  pools            ${args[4].join(", ")}
  operator (later) ${operator}
  attribution      ${env.ATTRIBUTION_CODE ?? (fork ? `${FORK_ATTRIBUTION_CODE} (fork placeholder)` : "(missing: live send will refuse)")}
  value moved      $0`);
  if (!fork && !live) return console.log("\nDry run only. Re-run with --fork <rpc> to rehearse, or --live after the go-ahead.");
  if (!(await confirm(`\n${fork ? "This deploys on the anvil fork." : "This sends a real Celo mainnet transaction."}`, "deploy"))) return console.log("Aborted. Nothing was sent.");

  const { hash, receipt } = await sendGuarded({
    mode: fork ? "fork" : "live",
    live: !fork,
    publicClient,
    walletClient: makeWalletClient(account, clientOpts),
    data,
    usdMicros: 0n,
    purpose: "deploy ArbolitoGuard v2",
    fees,
  });
  const guard = getAddress(receipt.contractAddress!);
  console.log(`\nDeployed: ${fork ? guard : addressUrl(guard)}\ntx: ${fork ? hash : txUrl(hash)} (block ${receipt.blockNumber}, gas used ${receipt.gasUsed})`);
  // Read the immutables back: the deployed guard must be the one we meant. A lagging RPC node can
  // answer "no data" for a few seconds after the receipt, so retry (reads only).
  const readBack = () =>
    Promise.all([
      publicClient.readContract({ address: guard, abi: arbolitoGuardAbi, functionName: "swapRouter" }),
      publicClient.readContract({ address: guard, abi: arbolitoGuardAbi, functionName: "twapWindow" }),
      ...args[4].map((p) => publicClient.readContract({ address: guard, abi: arbolitoGuardAbi, functionName: "isPinnedPool", args: [p] })),
    ]);
  let read: Awaited<ReturnType<typeof readBack>> | undefined;
  for (let i = 0; i < 10 && !read; i++) {
    read = await readBack().catch(() => undefined);
    if (!read) await new Promise((r) => setTimeout(r, 2_000));
  }
  if (!read) throw new Error(`Deployed at ${guard}, but its state could not be read back yet; check it on celoscan`);
  const [router, window, ...pinned] = read;
  console.log(`check: swapRouter ${router === args[0] ? "ok" : "MISMATCH"}, twap ${window === args[2] ? "ok" : "MISMATCH"}, pools pinned ${pinned.every(Boolean) ? "ok" : "MISMATCH"}`);
  if (!fork) console.log(`Next: GUARD_ADDRESS=${guard} and ARBOLITO_OPERATOR_ADDRESS=${operator} in .env and on Vercel; record both in docs/04-reference.md.`);
});
