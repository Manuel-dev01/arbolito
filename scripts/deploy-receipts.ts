/**
 * pnpm deploy:receipts [--live | --fork <rpc>] [--fee-currency USDT] [--yes]
 * Deploys ArbolitoReceipts from OPS_PRIVATE_KEY, owner = that address.
 * - no flag:  prints the plan and estimates gas (no transaction)
 * - --live:   Celo mainnet. Founder go-ahead required; typed confirmation; attribution appended
 * - --fork:   the same deploy against an anvil fork (rehearsal)
 */
import { encodeDeployData, formatEther } from "viem";
import { addressUrl, loadEnv, txUrl } from "@arbolito/config";
import { FORK_ATTRIBUTION_CODE, makePublicClient, makeWalletClient, sendGuarded, withAttribution } from "@arbolito/chain";
import { receiptsAbi, receiptsBytecode } from "@arbolito/proof";
import { confirm, flagValue, forkUrl, hasFlag, opsAccount, runMain } from "./lib/cli";

runMain(async () => {
  const fork = forkUrl();
  const live = hasFlag("live");
  if (fork && live) throw new Error("Pass either --live or --fork, not both");
  const execute = fork ? true : live;
  const feeCurrency = flagValue("fee-currency");
  const env = loadEnv();
  const account = opsAccount();
  const clientOpts = fork ? { rpcUrl: fork, pollingInterval: 200 } : {};
  const publicClient = makePublicClient(clientOpts);
  const walletClient = makeWalletClient(account, clientOpts);
  const data = encodeDeployData({ abi: receiptsAbi, bytecode: receiptsBytecode(), args: [account.address] });

  const [celo, gas] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.estimateGas({ account, data: withAttribution(data, env.ATTRIBUTION_CODE ?? FORK_ATTRIBUTION_CODE) }),
  ]);
  console.log(`Deploy ArbolitoReceipts to ${fork ? `anvil fork ${fork}` : "Celo mainnet"}
  from / owner     ${account.address}
  CELO balance     ${formatEther(celo)}
  gas estimate     ${gas}
  gas paid in      ${feeCurrency ?? "CELO"}
  attribution      ${env.ATTRIBUTION_CODE ?? (fork ? `${FORK_ATTRIBUTION_CODE} (fork placeholder)` : "(missing: live send will refuse)")}
  value moved      $0`);

  if (!execute) {
    console.log("\nDry run only. Re-run with --live after the founder approves (or --fork to rehearse).");
    return;
  }
  const what = fork ? "This deploys on the anvil fork." : "This sends a real Celo mainnet transaction.";
  if (!(await confirm(`\n${what}`, "deploy"))) {
    console.log("Aborted. Nothing was sent.");
    return;
  }
  const { hash, receipt } = await sendGuarded({
    mode: fork ? "fork" : "live",
    live: !fork,
    publicClient,
    walletClient,
    data,
    usdMicros: 0n,
    purpose: "deploy ArbolitoReceipts",
    feeCurrency,
  });
  const addr = receipt.contractAddress!;
  console.log(`\nDeployed: ${fork ? addr : addressUrl(addr)}\ntx: ${fork ? hash : txUrl(hash)}`);
  if (!fork) console.log("Next: set CONTRACTS.arbolitoReceipts in packages/config/src/contracts.ts and record it in docs/04-reference.md.");
});
