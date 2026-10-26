/**
 * Move a stablecoin from the ops wallet to another Arbolito wallet, or a founder-approved gift.
 *   pnpm ops:send desk USDT 40                  shows the plan (no transaction)
 *   pnpm ops:send buy USDT 30 --fork <rpc>      rehearse on an anvil fork
 *   pnpm ops:send desk USDT 40 --live [--yes]   Celo mainnet
 *   pnpm ops:send 0xAbc… USDT 5 --gift --live   a welcome credit to an address the founder approved
 * Destinations are the desk and buy payer wallets (derived from their keys) or, only with --gift,
 * an explicit address. Every send goes through sendGuarded (caps, simulation, ERC-8021 suffix), is
 * never retried, and a live one is appended to docs/TREASURY.md so every dollar stays accounted for.
 */
import { appendFileSync } from "node:fs";
import { erc20Abi, encodeFunctionData, formatUnits, getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKENS, loadEnv, txUrl } from "@arbolito/config";
import { FileLedger, MemoryLedger, makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { confirm, forkUrl, hasFlag, opsAccount, runMain } from "./lib/cli";

const STABLES = ["USDT", "USDC", "USAT"] as const;

runMain(async () => {
  const [dest, sym, human] = process.argv.slice(2).filter((a) => !a.startsWith("--") && !/^https?:/.test(a));
  if (!dest || !sym || !human) throw new Error("usage: pnpm ops:send <desk|buy|0xAddress --gift> <USDT|USDC|USAT> <amount> [--fork <rpc> | --live [--yes]]");
  if (!(STABLES as readonly string[]).includes(sym)) throw new Error(`only dollar stablecoins (${STABLES.join(", ")}): ${sym}`);
  const token = TOKENS[sym as (typeof STABLES)[number]];
  const amount = parseUnits(human, token.decimals);
  if (amount <= 0n) throw new Error("amount must be positive");

  const env = loadEnv();
  const roleKey = { desk: env.DESK_PRIVATE_KEY, buy: env.BUY_PAYER_PRIVATE_KEY }[dest];
  let to: Address;
  let label: string;
  if (dest === "desk" || dest === "buy") {
    if (!roleKey) throw new Error(`${dest === "desk" ? "DESK" : "BUY_PAYER"}_PRIVATE_KEY is not set`);
    to = privateKeyToAccount(roleKey as Hex).address;
    label = dest === "desk" ? "desk wallet" : "buy payer";
  } else if (isAddress(dest) && hasFlag("gift")) {
    to = getAddress(dest);
    label = "welcome credit";
  } else {
    throw new Error("destination must be desk, buy, or an address with --gift");
  }

  const fork = forkUrl();
  const live = hasFlag("live");
  if (fork && live) throw new Error("Pass either --live or --fork, not both");
  const ops = opsAccount();
  const clientOpts = fork ? { rpcUrl: fork, pollingInterval: 200 } : {};
  const publicClient = makePublicClient(clientOpts);
  const bal = (a: Address) => publicClient.readContract({ address: token.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [a] });
  const [opsBal, toBal] = await Promise.all([bal(ops.address), bal(to)]);
  console.log(`${fork ? `anvil fork ${fork}` : "Celo mainnet"}: ${human} ${sym} ops ${ops.address} → ${label} ${to}`);
  console.log(`ops ${formatUnits(opsBal, token.decimals)} ${sym}, ${label} ${formatUnits(toBal, token.decimals)} ${sym}`);
  if (opsBal < amount) throw new Error(`ops holds only ${formatUnits(opsBal, token.decimals)} ${sym}`);
  if (!fork && !live) return console.log("\nPlan only. Re-run with --fork <rpc> to rehearse, or --live once approved.");
  if (live && !(await confirm(`Send ${human} ${sym} from ops to the ${label} on Celo mainnet?`))) return console.log("Cancelled.");

  const r = await sendGuarded({
    mode: fork ? "fork" : "live",
    live,
    publicClient,
    walletClient: makeWalletClient(ops, clientOpts),
    to: token.address as Address,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
    usdMicros: parseUnits(human, 6), // dollar stablecoins: 1 unit = US$ 1
    purpose: `ops → ${label} ${human} ${sym}`,
    ledger: fork ? new MemoryLedger() : new FileLedger(),
  });
  console.log(`sent: ${fork ? r.hash : txUrl(r.hash)}`);
  if (live) {
    appendFileSync("docs/TREASURY.md", `| ${new Date().toISOString().slice(0, 16).replace("T", " ")} | ops → ${label} | ${to} | ${human} ${sym} | [tx](${txUrl(r.hash)}) |\n`);
    console.log("logged in docs/TREASURY.md");
  }
});
