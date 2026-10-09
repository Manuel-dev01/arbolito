/**
 * pnpm quote <from> <to> <amount>
 * e.g. pnpm quote wBRL wARS 200
 * Read-only: prints the best route, alternatives and reference rates. Sends nothing.
 */
import { zeroAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadEnv, tokenBySymbol } from "@arbolito/config";
import { makePublicClient } from "@arbolito/chain";
import { effectiveRate, fmtAmount, toAtomic } from "../format";
import { plan } from "../planner";
import { fetchReferences, fiatOf, referenceRate } from "../refs";
import { TextileRfqAdapter } from "../textile/rfq";
import { UniswapV3Adapter } from "../uniswap/adapter";
import type { Reference, Route } from "../types";

const [fromArg, toArg, amountArg] = process.argv.slice(2);
if (!fromArg || !toArg || !amountArg) {
  console.error("usage: pnpm quote <from> <to> <amount>   e.g. pnpm quote wBRL wARS 200");
  process.exit(2);
}

async function main(fromArg: string, toArg: string, amountArg: string) {
  const t0 = 0; // measure from process start (includes tsx boot and module load)
  const env = loadEnv();
  const from = tokenBySymbol(fromArg);
  const to = tokenBySymbol(toArg);
  const amountIn = toAtomic(from.address, amountArg);
  const taker: Address = env.OPS_PRIVATE_KEY ? privateKeyToAccount(env.OPS_PRIVATE_KEY as `0x${string}`).address : zeroAddress;

  const client = makePublicClient();
  const blockNumber = await client.getBlockNumber();
  const textile = new TextileRfqAdapter();
  const [result, refs] = await Promise.all([
    plan({ client, adapters: [new UniswapV3Adapter(client), textile], tokenIn: from.address, tokenOut: to.address, amountIn, taker, blockNumber }),
    fetchReferences(client, blockNumber),
  ]);
  const elapsed = Math.round(performance.now() - t0);

  const rateOf = (r: Route) => effectiveRate(r.tokenIn, r.amountIn, r.tokenOut, r.expectedOut);
  const [base, quote] = [fiatOf(from.symbol), fiatOf(to.symbol)];
  const pair = `${base}/${quote}`;
  const refFor = (name: Reference["name"]) => referenceRate(refs.references, name, base, quote);

  console.log(`\n${fmtAmount(from.address, amountIn)} → ${to.symbol}   (block ${blockNumber})\n`);
  if (!result.best) {
    console.log("No route found. No venue could quote this pair and size right now.");
  } else {
    const best = result.best;
    console.log(`BEST   ${fmtAmount(to.address, best.expectedOut)}   rate ${rateOf(best).toPrecision(6)} ${pair}`);
    console.log(`       ${best.label}`);
    console.log(`       min out (${((Number(best.expectedOut - best.minOut) * 10_000) / Number(best.expectedOut)).toFixed(0)} bps slippage): ${fmtAmount(to.address, best.minOut)}`);
    if (result.alternatives.length) {
      console.log("\nALTERNATIVES");
      for (const alt of result.alternatives) {
        const diffBps = Number(((alt.expectedOut - best.expectedOut) * 10_000n) / best.expectedOut);
        console.log(`       ${fmtAmount(to.address, alt.expectedOut).padEnd(24)} ${String(diffBps).padStart(6)} bps   ${alt.label}`);
      }
    }
}

console.log("\nREFERENCES");
for (const r of refs.references) {
  console.log(`       ${r.name.padEnd(12)} ${r.pair.padEnd(8)} ${r.rate.padStart(12)}   ${r.source}`);
}
if (result.best) {
  const ours = rateOf(result.best);
  const lines = (["official", "mep", "ccl", "crypto"] as const)
    .map((n) => [n, refFor(n)] as const)
    .filter((x): x is readonly [(typeof x)[0], number] => x[1] !== undefined)
    .map(([n, v]) => `${n} ${((ours / v - 1) * 100).toFixed(2)}%`);
  if (lines.length) console.log(`\nVS REFERENCES (${pair}): ${lines.join("   ")}`);
}
if (refs.unavailable.length) console.log(`\nunavailable: ${refs.unavailable.join(", ")}`);
const notes: string[] = [];
if (!textile.enabled) notes.push("Textile RFQ off (no key / flag)");
for (const e of result.venueErrors) notes.push(`${e.venue} ${e.tokenIn}→${e.tokenOut}: ${e.error}`);
if (notes.length) console.log(`notes: ${notes.join("; ")}`);
console.log(`\n${result.quotesConsidered.length} quotes considered in ${elapsed} ms${elapsed > 4000 ? "  (over the 4s budget)" : ""}`);
}

// Exit via exitCode + an unref'd timer: a hung DNS lookup from a timed-out reference fetch
// can keep Node alive, but calling process.exit() mid-teardown trips a libuv assert on Windows.
const exitSoon = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 250).unref();
};
main(fromArg, toArg, amountArg).then(
  () => exitSoon(0),
  (err: unknown) => {
    const e = err as { shortMessage?: string; message?: string };
    console.error(`quote failed: ${e.shortMessage ?? e.message ?? String(err)}`);
    exitSoon(1);
  },
);
