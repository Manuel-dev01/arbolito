/**
 * Pays an outside Celo agent once over x402 and rates it on ERC-8004 (what AGENT_BUYS=live does
 * from the bot). Without --live it only reads each provider's free 402 and prints the price.
 *
 *   pnpm agent:buy                 # quotes (free)
 *   pnpm agent:buy RemitRoute --live
 */
import { formatUnits } from "viem";
import { loadEnv, txUrl } from "@arbolito/config";
import { closeDb, getDb } from "@arbolito/db";
import { PROVIDERS, buyFromProvider, quoteProvider } from "../apps/agent/src/agent-buys";
import { confirm, hasFlag, positional } from "./lib/cli";

const env = loadEnv();
const [name] = positional();
const chosen = name ? PROVIDERS.filter((p) => p.name.toLowerCase() === name.toLowerCase()) : PROVIDERS;
if (!chosen.length) throw new Error(`unknown provider; known: ${PROVIDERS.map((p) => p.name).join(", ")}`);

for (const p of chosen) {
  const q = await quoteProvider(p);
  console.log(`${p.name} (#${p.agentId}) asks ${formatUnits(q.amount, 6)} ${p.pay} to ${q.requirement.payTo} for ${p.url}`);
}
if (!hasFlag("live")) process.exit(0);
if (chosen.length !== 1) throw new Error("--live pays one provider: name it");
const p = chosen[0]!;
if (!(await confirm(`Pay ${p.name} from the agent wallet, then rate it on ERC-8004 (a tagged, gas-only tx)?`, "pay"))) process.exit(1);
const db = getDb(env.DATABASE_URL);
try {
  const r = await buyFromProvider(db, env, p);
  console.log(`paid ${formatUnits(r.priceMicros, 6)} ${p.pay}: ${r.paymentTx ? txUrl(r.paymentTx) : "no settlement tx in the answer"}`);
  console.log(`rating: ${r.feedbackTx ? txUrl(r.feedbackTx) : "not sent"}`);
  console.log(`answer: ${JSON.stringify(r.body).slice(0, 1500)}`);
} finally {
  await closeDb();
}
