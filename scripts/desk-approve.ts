/**
 * Top up one bounded Permit2 approval from the desk wallet (Stitch refuses to start when a token
 * it sells has no allowance left: fills spend it down).
 *   pnpm desk:approve wBRL 300                  shows the plan (no transaction)
 *   pnpm desk:approve wBRL 300 --fork <rpc>     rehearse on an anvil fork
 *   pnpm desk:approve wBRL 300 --live [--yes]   Celo mainnet
 * Gas only (no funds move), tagged and simulated through sendGuarded. Never max: an exact amount.
 */
import { erc20Abi, encodeFunctionData, formatUnits, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, TOKENS, loadEnv, txUrl } from "@arbolito/config";
import { FileLedger, MemoryLedger, makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { confirm, forkUrl, hasFlag, runMain } from "./lib/cli";

runMain(async () => {
  const [sym, human] = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/^https?:/.test(a));
  if (!sym || !human || !(sym in TOKENS)) throw new Error("usage: pnpm desk:approve <SYM> <amount> [--fork <rpc> | --live [--yes]]");
  const token = TOKENS[sym as keyof typeof TOKENS];
  const amount = parseUnits(human, token.decimals);
  const fork = forkUrl();
  const live = hasFlag("live");
  if (fork && live) throw new Error("Pass either --live or --fork, not both");
  const env = loadEnv();
  if (!env.DESK_PRIVATE_KEY) throw new Error("DESK_PRIVATE_KEY is not set");
  const desk = privateKeyToAccount(env.DESK_PRIVATE_KEY as Hex);
  const clientOpts = fork ? { rpcUrl: fork, pollingInterval: 200 } : {};
  const publicClient = makePublicClient(clientOpts);
  const read = (fn: "allowance" | "balanceOf") =>
    publicClient.readContract({ address: token.address as Address, abi: erc20Abi, functionName: fn, args: fn === "allowance" ? [desk.address, CONTRACTS.permit2 as Address] : [desk.address] } as never) as Promise<bigint>;

  const [before, balance] = await Promise.all([read("allowance"), read("balanceOf")]);
  console.log(`Desk ${desk.address} on ${fork ? `anvil fork ${fork}` : "Celo mainnet"}`);
  console.log(`${sym}: balance ${formatUnits(balance, token.decimals)}, Permit2 allowance ${formatUnits(before, token.decimals)} → ${human}`);
  if (!fork && !live) return console.log("\nPlan only. Re-run with --fork <rpc> to rehearse, or --live once approved.");
  if (live && !(await confirm(`Send approve(Permit2, ${human} ${sym}) from the desk wallet on Celo mainnet?`))) return console.log("Cancelled.");

  const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CONTRACTS.permit2 as Address, amount] });
  const r = await sendGuarded({
    mode: fork ? "fork" : "live",
    live,
    publicClient,
    walletClient: makeWalletClient(desk, clientOpts),
    to: token.address as Address,
    data,
    usdMicros: 0n,
    purpose: `desk Permit2 approval ${sym}`,
    ledger: fork ? new MemoryLedger() : new FileLedger(),
  });
  console.log(`approved Permit2 for ${human} ${sym}: ${fork ? r.hash : txUrl(r.hash)}`);
  // The approval is done; a flaky read here is not a failure (re-run without --live to check).
  const after = await read("allowance").catch(() => undefined);
  console.log(after === undefined ? "allowance read failed; re-run without --live to check it" : `allowance now ${formatUnits(after, token.decimals)}`);
});
