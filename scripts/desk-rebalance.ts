/**
 * pnpm desk:rebalance [--fork <rpc>]
 * One rebalancer decision, outside the running desk: reads fair prices and the desk wallet's
 * balances, picks the next slice (apps/desk/src/rebalance.ts) and quotes it.
 * - no flag: dry (quote and log only, no transaction)
 * - --fork:  executes the slice on an anvil fork (rehearsal)
 * The live rebalancer runs inside desk-feed (DESK_REBALANCE=live). One-shot runs never use
 * Textile: the self-trade guard needs the buy side to have been off for a while, which only the
 * running desk knows.
 */
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv } from "@arbolito/config";
import { MemoryLedger, makePublicClient, makeWalletClient } from "@arbolito/chain";
import { CORRIDORS, FeedService, Rebalancer, buySidesOff, type Balances } from "@arbolito/desk";
import { forkUrl, runMain } from "./lib/cli";

runMain(async () => {
  const env = loadEnv();
  if (!env.DESK_PRIVATE_KEY) throw new Error("DESK_PRIVATE_KEY is not set");
  const fork = forkUrl();
  const desk = privateKeyToAccount(env.DESK_PRIVATE_KEY as Hex);
  const clientOpts = fork ? { rpcUrl: fork, pollingInterval: 200 } : {};
  const client = makePublicClient(clientOpts);
  const log = (l: string) => console.log(l);

  let seen: { balances?: Balances; usdtPerSoft: Record<string, number | undefined> } | undefined;
  const svc = new FeedService({ client, port: 0, deskAddress: desk.address, log: (l) => (l.startsWith("sources:") ? log(l) : undefined), onTick: (t) => (seen = t) });
  await svc.tick();
  if (!seen?.balances) throw new Error("couldn't read the desk's balances");
  const { balances, usdtPerSoft } = seen;
  const buyOff = buySidesOff(balances, CORRIDORS, usdtPerSoft, new Set());
  const fmt = (n: number | undefined) => (n === undefined ? "no fair" : n.toPrecision(5));
  console.log(`fair (USDT per coin): ${CORRIDORS.map((c) => `${c.soft} ${fmt(usdtPerSoft[c.pair])}`).join(", ")}`);
  console.log(`Desk ${desk.address} on ${fork ? `anvil fork ${fork}` : "Celo mainnet (dry)"}; buy side off: [${[...buyOff].join(", ") || "none"}]`);

  const r = new Rebalancer({ mode: fork ? "fork" : "dry", publicClient: client, account: desk, walletClient: makeWalletClient(desk, clientOpts), ledger: new MemoryLedger(), textileFirm: false, log });
  r.observe(buyOff);
  const slice = await r.maybeSell(balances, CORRIDORS, usdtPerSoft, buyOff);
  if (!slice) console.log("Nothing to rebalance.");
  console.log(JSON.stringify(r.status().recent, null, 2));
});
