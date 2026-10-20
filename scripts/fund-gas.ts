/**
 * pnpm fund:gas <operator|anchor|desk> <celo> [--fork <rpc> | --live] [--yes]
 * Tops up one of Arbolito's own hot wallets with CELO for gas, from the ops wallet. Only these
 * three targets (derived from their keys in .env); the amount is capped at 1 CELO per send.
 * Every send is tagged (sendGuarded) and charged to the build caps (CELO valued at ≤ US$ 1).
 */
import { formatEther, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv, txUrl } from "@arbolito/config";
import { FileLedger, MemoryLedger, makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { confirm, forkUrl, hasFlag, opsAccount, positional, runMain } from "./lib/cli";

const MAX_CELO = parseEther("1");
const CELO_USD_CEILING_MICROS = 1_000_000n;

runMain(async () => {
  const [target, amount] = positional();
  const env = loadEnv();
  const keys: Record<string, string | undefined> = { operator: env.ARBOLITO_OPERATOR_PRIVATE_KEY, anchor: env.ANCHOR_PRIVATE_KEY, desk: env.DESK_PRIVATE_KEY };
  if (!target || !(target in keys) || !amount) throw new Error("usage: pnpm fund:gas <operator|anchor|desk> <celo> [--fork <rpc> | --live]");
  const key = keys[target];
  if (!key) throw new Error(`no key for ${target} in .env`);
  const to = privateKeyToAccount(key as Hex).address as Address;
  const value = parseEther(amount);
  if (value <= 0n || value > MAX_CELO) throw new Error("amount must be between 0 and 1 CELO");

  const fork = forkUrl();
  const live = hasFlag("live");
  if (fork && live) throw new Error("Pass either --live or --fork, not both");
  const clientOpts = fork ? { rpcUrl: fork, pollingInterval: 200 } : {};
  const publicClient = makePublicClient(clientOpts);
  const ops = opsAccount();
  const [opsBal, toBal] = await Promise.all([publicClient.getBalance({ address: ops.address }), publicClient.getBalance({ address: to })]);
  console.log(`Send ${amount} CELO for gas: ops ${ops.address} (${formatEther(opsBal)} CELO) → ${target} ${to} (${formatEther(toBal)} CELO) on ${fork ? `anvil fork ${fork}` : "Celo mainnet"}`);
  if (!fork && !live) return console.log("Plan only. Re-run with --fork <rpc> to rehearse, or --live after the go-ahead.");
  if (live && !(await confirm("\nThis sends CELO from the ops wallet on Celo mainnet.", "send"))) return console.log("Aborted. Nothing was sent.");
  const r = await sendGuarded({
    mode: fork ? "fork" : "live",
    live,
    publicClient,
    walletClient: makeWalletClient(ops, clientOpts),
    to,
    data: "0x",
    value,
    usdMicros: (value * CELO_USD_CEILING_MICROS) / 10n ** 18n,
    purpose: `gas for ${target}`,
    ledger: fork ? new MemoryLedger() : new FileLedger(),
  });
  console.log(`sent: ${fork ? r.hash : txUrl(r.hash)}; ${target} now holds ${formatEther(await publicClient.getBalance({ address: to }))} CELO`);
});
