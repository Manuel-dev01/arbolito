/**
 * Prints the desk's stitch.toml (apps/desk/src/stitch-config.ts) to stdout.
 *   pnpm desk:stitch-config --feed-base http://localhost:8790 > .arbolito/stitch/stitch.toml
 */
import { CORRIDORS, stitchToml } from "@arbolito/desk";
import { loadEnv } from "@arbolito/config";
import { flagValue, runMain } from "./lib/cli";

runMain(async () => {
  const env = loadEnv();
  const base = flagValue("feed-base") ?? `http://localhost:${env.DESK_FEED_PORT}`;
  process.stdout.write(stitchToml(CORRIDORS, { feedBaseUrl: base, rpcUrl: env.CELO_RPC_URL }));
});
