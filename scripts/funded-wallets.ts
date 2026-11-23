/**
 * Every wallet the team's public wallets (packages/config/src/team.ts) ever sent tokens to, from
 * Blockscout. Those wallets aren't independent in the hackathon's sense, so /metrics never counts them.
 *   pnpm funded:wallets            counts only (no addresses printed: they include personal transfers)
 *   pnpm funded:wallets --write    also saves FUNDED_WALLETS in .env (gitignored)
 * Read-only. One hop: it doesn't follow what a funded wallet sends on, nor who funds the founder. The
 * private TEAM_WALLETS aren't looked up (that would link them on a third-party explorer). A failed
 * or truncated listing aborts: a short list would overcount users.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { TEAM_WALLETS, loadEnv, teamWallets } from "@arbolito/config";

const API = "https://celo.blockscout.com/api/v2/addresses";
const MAX_PAGES = 200;

interface Page {
  items: { from: { hash: string }; to: { hash: string } }[];
  next_page_params: Record<string, string | number> | null;
}

async function page(url: string): Promise<Page> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as Page;
    } catch (e) {
      if (i === 4) throw e;
      await new Promise((ok) => setTimeout(ok, 1_500 * (i + 1)));
    }
  }
}

async function main() {
  const team = teamWallets(loadEnv().TEAM_WALLETS);
  const funded = new Set<string>();
  for (const [name, address] of Object.entries(TEAM_WALLETS)) {
    if (name === "desk") continue; // its outflows are Textile fills, paid for by the taker
    const before = funded.size;
    let next = "";
    for (let n = 0; ; n++) {
      if (n === MAX_PAGES) throw new Error(`${name}: more than ${MAX_PAGES} pages; nothing written`);
      const p = await page(`${API}/${address}/token-transfers?type=ERC-20&filter=from${next}`);
      for (const t of p.items) {
        const to = t.to.hash.toLowerCase();
        if (t.from.hash.toLowerCase() === address.toLowerCase() && !team.has(to)) funded.add(to);
      }
      if (!p.next_page_params) break;
      next = `&${new URLSearchParams(Object.entries(p.next_page_params).map(([k, v]) => [k, String(v)]))}`;
    }
    console.log(`${name}: +${funded.size - before}`);
  }
  console.log(`${funded.size} funded addresses (contracts included: they are never takers)`);
  if (!process.argv.includes("--write")) return;
  const line = `FUNDED_WALLETS=${[...funded].sort().join(",")}`;
  const env = readFileSync(".env", "utf8");
  const has = /^FUNDED_WALLETS=.*$/m.test(env);
  writeFileSync(".env", has ? env.replace(/^FUNDED_WALLETS=[^\r\n]*/m, line) : env.replace(/^(TEAM_WALLETS=[^\r\n]*)/m, `$1\n${line}`));
  console.log("saved FUNDED_WALLETS in .env");
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
