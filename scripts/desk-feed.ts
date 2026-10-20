/**
 * Runs the desk: the pricing feed (apps/desk) and, when configured, Stitch itself as a supervised
 * child that quotes from it.
 *   pnpm desk:feed            serve on DESK_FEED_PORT (default 8790) until stopped
 *   pnpm desk:feed --once     one tick, print the state, exit (a quick look at what we'd publish)
 * Feed-only by default: reads public prices and the desk wallet's balances, holds no key.
 * With DESK_STITCH_BIN + DESK_RFQ_API_KEY + DESK_PRIVATE_KEY it also runs Stitch on a config it
 * regenerates every tick, switching a buy side off when that corridor's inventory cap is reached
 * (apps/desk/src/limits.ts) and restarting Stitch only when the config changes.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv } from "@arbolito/config";
import { makePublicClient, makeWalletClient } from "@arbolito/chain";
import { DbLedger, getDb } from "@arbolito/db";
import { textileFirmEnabled } from "@arbolito/router";
import { createLlmClient } from "@arbolito/llm";
import { CORRIDORS, DESK_MAKER, DeskLedger, FeedService, Rebalancer, StitchSupervisor, buySidesOff, buySizes, parseRfqResult, stitchToml } from "@arbolito/desk";
import { hasFlag, runMain } from "./lib/cli";

function deskAddress(): Address | undefined {
  const env = loadEnv();
  if (env.DESK_ADDRESS) return env.DESK_ADDRESS as Address;
  return env.DESK_PRIVATE_KEY ? privateKeyToAccount(env.DESK_PRIVATE_KEY as Hex).address : undefined;
}

const stamp = () => new Date().toISOString().slice(11, 19);

if (hasFlag("once")) {
  runMain(async () => {
    const svc = new FeedService({ client: makePublicClient(), port: 0, deskAddress: deskAddress(), log: (l) => console.log(`${stamp()} ${l}`) });
    await svc.tick();
    console.log(JSON.stringify(svc.state(), null, 2));
  });
} else {
  const env = loadEnv();
  const address = deskAddress();
  const client = makePublicClient();
  const log = (l: string) => console.log(`${stamp()} ${l}`);
  // Fills and snapshots go to Postgres when DATABASE_URL is set (Railway); without it, the feed still runs.
  const ledger = address && env.DATABASE_URL ? new DeskLedger(getDb(), client, address, CORRIDORS, log) : undefined;
  // The risk officer only runs when explicitly enabled (paid LLM calls, ~every 15 min).
  const risk = env.DESK_RISK_OFFICER && env.DEEPSEEK_API_KEY ? { llm: createLlmClient(), model: env.RISK_OFFICER_MODEL } : undefined;

  // Stitch in-process (optional). It reads the feed over localhost, so no public hop is needed.
  const supervisor =
    env.DESK_STITCH_BIN && env.DESK_RFQ_API_KEY && env.DESK_PRIVATE_KEY
      ? new StitchSupervisor({
          bin: env.DESK_STITCH_BIN,
          dir: join(homedir(), "stitch-run"),
          privateKey: env.DESK_PRIVATE_KEY,
          rfqApiKey: env.DESK_RFQ_API_KEY,
          log,
          // RFQs our quote won, into the ledger (best effort; never blocks Stitch).
          onLine: (line) => {
            const r = parseRfqResult(line);
            if (r && ledger) void ledger.recordRfqResult(r.rfqId, r.result).catch((e: Error) => log(`rfq record failed: ${e.message}`));
          },
        })
      : undefined;
  // Rebalancer (optional, DESK_REBALANCE): sells inventory above a cap back to USDT, within the spend caps.
  const deskAccount = env.DESK_PRIVATE_KEY ? privateKeyToAccount(env.DESK_PRIVATE_KEY as Hex) : undefined;
  const rebalancer =
    supervisor && deskAccount && env.DESK_REBALANCE !== "off"
      ? new Rebalancer({
          mode: env.DESK_REBALANCE,
          publicClient: client,
          account: deskAccount,
          walletClient: makeWalletClient(deskAccount),
          ledger: env.DATABASE_URL ? new DbLedger(getDb(), deskAccount.address) : undefined,
          textileFirm: textileFirmEnabled(),
          feeCurrency: "USDT", // gas in USDT (the desk holds USDT, little CELO)
          log,
        })
      : undefined;
  let buyOff = new Set<string>();
  let buySize = new Map<string, bigint>();
  let ready = false;
  const stitchConfig = () => stitchToml(CORRIDORS, { feedBaseUrl: `http://127.0.0.1:${env.DESK_FEED_PORT}`, rpcUrl: env.CELO_RPC_URL, buyOff, buySize, rfq: DESK_MAKER });

  const svc = new FeedService({
    client,
    port: env.DESK_FEED_PORT,
    deskAddress: address,
    ledger,
    risk,
    log,
    onTick: ({ balances, usdtPerSoft }) => {
      if (!supervisor || !ready || !balances) return;
      const next = buySidesOff(balances, CORRIDORS, usdtPerSoft, buyOff);
      const changed = next.size !== buyOff.size || [...next].some((p) => !buyOff.has(p));
      if (changed) log(`inventory caps: buy side off for [${[...next].join(", ") || "none"}]`);
      buyOff = next;
      // Size each buy side to the room left under its cap, so one fill can't overshoot it.
      const sizes = buySizes(balances, CORRIDORS, usdtPerSoft, buySize);
      if ([...sizes].some(([p, v]) => buySize.get(p) !== v)) log(`buy sizes: ${[...sizes].map(([p, v]) => `${p}=${Number(v) / 1e6}`).join(", ")}`);
      buySize = sizes;
      supervisor.apply(stitchConfig());
      if (rebalancer) {
        rebalancer.observe(buyOff);
        void rebalancer.maybeSell(balances, CORRIDORS, usdtPerSoft, buyOff);
      }
    },
    extraState: () => ({
      ...(supervisor ? { stitch: { ...supervisor.status(), buySidesOff: [...buyOff] } } : {}),
      ...(rebalancer ? { rebalancer: rebalancer.status() } : {}),
    }),
  });
  svc.start().then(
    () => {
      ready = true; // Stitch starts on the next tick, once the feed is serving
      console.log(
        `desk feed on :${env.DESK_FEED_PORT} (${svc.corridors.map((c) => `/feed/${c.pair}`).join(", ")}); inventory from ${address ?? "nowhere (no skew)"}; ledger ${ledger ? "on" : "off"}; risk officer ${risk ? "on" : "off"}; rebalancer ${env.DESK_REBALANCE}; stitch ${supervisor ? "supervised" : "external"}`,
      );
    },
    (e: Error) => {
      console.error(`failed: ${e.message}`);
      process.exitCode = 1;
    },
  );
  const stop = () => void Promise.all([svc.stop(), supervisor?.stop()]).then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
