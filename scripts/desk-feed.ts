/**
 * Runs the desk pricing feed (apps/desk) that Stitch quotes from.
 *   pnpm desk:feed            serve on DESK_FEED_PORT (default 8790) until stopped
 *   pnpm desk:feed --once     one tick, print the state, exit (a quick look at what we'd publish)
 * Reads only; holds no key. Inventory comes from DESK_ADDRESS (or the address of DESK_PRIVATE_KEY).
 */
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv } from "@arbolito/config";
import { makePublicClient } from "@arbolito/chain";
import { getDb } from "@arbolito/db";
import { CORRIDORS, DeskLedger, FeedService } from "@arbolito/desk";
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
  const svc = new FeedService({ client, port: env.DESK_FEED_PORT, deskAddress: address, ledger, log });
  svc.start().then(
    () => console.log(`desk feed on :${env.DESK_FEED_PORT} (${svc.corridors.map((c) => `/feed/${c.pair}`).join(", ")}); inventory from ${address ?? "nowhere (no skew)"}; ledger ${ledger ? "on" : "off"}`),
    (e: Error) => {
      console.error(`failed: ${e.message}`);
      process.exitCode = 1;
    },
  );
  const stop = () => void svc.stop().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
