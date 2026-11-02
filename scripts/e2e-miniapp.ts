/**
 * End-to-end check of a Mini App conversion. It drives the same server code MiniPay hits
 * (createQuote → prepareQuote → the wallet sends each call → submitQuote) and signs as the team's
 * e2e wallet (E2E_PRIVATE_KEY).
 *   pnpm e2e:miniapp USDT wCOP 1                 plan only: quote + prepare, then release the quote
 *   pnpm e2e:miniapp USDT wCOP 1 --fork <rpc>    the calls run on an anvil fork; the firm Textile quote
 *                                               is real (Textile checks mainnet funds) and is released after
 *   pnpm e2e:miniapp USDT wCOP 1 --live [--yes]  Celo mainnet: send, submit, anchor the receipt
 * Gas is paid in USDT through its fee adapter on mainnet, as MiniPay does (CELO on the fork).
 */
import { formatUnits, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TOKENS, loadEnv, txUrl } from "@arbolito/config";
import { attributionCodes, feeCurrencyFor, makePublicClient, makeWalletClient } from "@arbolito/chain";
import { receivedInTx } from "@arbolito/router";
import { SYMBOLS, type Sym } from "../apps/web/src/lib/miniapp/contract";
import { buildDeps } from "../apps/web/src/lib/miniapp/server/deps";
import { prepareQuote } from "../apps/web/src/lib/miniapp/server/prepare";
import { createQuote } from "../apps/web/src/lib/miniapp/server/quote";
import { getMiniappReceipt } from "../apps/web/src/lib/miniapp/server/receipt";
import { rejectQuote } from "../apps/web/src/lib/miniapp/server/reject";
import { submitQuote } from "../apps/web/src/lib/miniapp/server/submit";
import { confirm, forkUrl, hasFlag, positional, runMain } from "./lib/cli";

const isSym = (s: string | undefined): s is Sym => !!s && (SYMBOLS as readonly string[]).includes(s);

runMain(async () => {
  const [from, to, amount] = positional();
  if (!isSym(from) || !isSym(to) || !amount) throw new Error(`usage: pnpm e2e:miniapp <from> <to> <amount> [--fork <rpc> | --live [--yes]]; tokens: ${SYMBOLS.join(", ")}`);
  const env = loadEnv();
  if (!env.E2E_PRIVATE_KEY) throw new Error("E2E_PRIVATE_KEY is not set");
  const wallet = privateKeyToAccount(env.E2E_PRIVATE_KEY as Hex);
  const account = wallet.address.toLowerCase() as Address;
  const fork = forkUrl();
  const live = hasFlag("live");
  if (fork && live) throw new Error("Pass either --live or --fork, not both");

  // Quotes and the firm quote read mainnet; only the sends go to the fork. Textile firm quotes
  // need TEXTILE_RFQ_ENABLED on the server; it is on in production (Vercel).
  const deps = { ...buildDeps(), textileEnabled: true };
  const execClient = fork ? makePublicClient({ rpcUrl: fork, pollingInterval: 200 }) : deps.chain;
  const walletClient = makeWalletClient(wallet, fork ? { rpcUrl: fork, pollingInterval: 200 } : {});
  const out = TOKENS[to];

  console.log(`${fork ? `anvil fork ${fork}` : live ? "Celo mainnet" : "plan only"}: ${amount} ${from} → ${to} for e2e wallet ${wallet.address}`);
  const q = await createQuote(deps, { from, to, amount, account, lang: "es" });
  console.log(`quote ${q.quoteId}: ${formatUnits(BigInt(q.expectedOut), out.decimals)} ${to} (min ${formatUnits(BigInt(q.minOut), out.decimals)}), venues ${q.venues.join("+")}, rate ${q.rate}`);
  console.log(`references: ${q.references.map((r) => `${r.name} ${r.pair} ${r.rate}`).join(" · ")}`);

  const prepared = await prepareQuote(deps, { quoteId: q.quoteId, account });
  console.log(`prepared ${prepared.calls.length} call(s), firm until ${prepared.expiresAt}: ${prepared.calls.map((c) => c.label).join(" → ")}`);
  for (const c of prepared.calls) {
    const codes = attributionCodes(c.data as Hex);
    if (!codes.includes(env.ATTRIBUTION_CODE ?? "")) throw new Error(`call "${c.label}" lacks the attribution tag (found ${codes.join(",") || "none"})`);
  }

  const release = async (why: string) => {
    const r = await rejectQuote(deps, { quoteId: q.quoteId, account });
    console.log(`${why}: quote ${r.status}, firm Textile quote released`);
  };
  if (!fork && !live) return release("Plan only. Re-run with --fork <rpc> to rehearse, or --live once approved");
  if (live && !(await confirm(`Convert ${amount} ${from} → ${to} on Celo mainnet from the e2e wallet?`))) return release("Cancelled");

  if (fork) await execClient.request({ method: "anvil_setBalance" as never, params: [wallet.address, `0x${parseEther("1").toString(16)}`] as never });
  const hashes: Hex[] = [];
  let got = 0n;
  try {
    for (const c of prepared.calls) {
      const hash = await walletClient.sendTransaction({
        account: wallet,
        chain: walletClient.chain,
        to: c.to as Address,
        data: c.data as Hex,
        value: BigInt(c.value),
        ...(live ? { feeCurrency: feeCurrencyFor("USDT") } : {}),
      } as never);
      const rc = await execClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
      console.log(`  ${c.label}: ${rc.status} ${live ? txUrl(hash) : hash}`);
      if (rc.status !== "success") throw new Error(`${c.label} reverted`);
      hashes.push(hash);
      // From the Transfer logs, as the server does: a balance diff would include gas paid in the same token.
      got += receivedInTx(rc, out.address as Address, wallet.address);
    }
  } catch (err) {
    // Nothing is retried: a lost send may still land (the RFQ's orderDeadline bounds it).
    if (fork) await release("Fork send failed");
    throw err;
  }
  console.log(`received ${formatUnits(got, out.decimals)} ${to} (min ${formatUnits(BigInt(prepared.minOut), out.decimals)}): ${got >= BigInt(prepared.minOut) ? "OK" : "BELOW MINIMUM"}`);

  if (fork) return release("Fork run done (no receipt for a fork tx)");
  const sub = await submitQuote(deps, { quoteId: q.quoteId, account, txHashes: hashes });
  console.log(`submitted: receipt ${sub.receiptId} ${sub.status} ${sub.url}`);
  for (let i = 0; i < 12; i++) {
    const r = await getMiniappReceipt(deps, sub.receiptId);
    if (r.status !== "registering") return console.log(`receipt ${r.status}${r.anchorTx ? `, anchored ${txUrl(r.anchorTx as Hex)}` : ""}`);
    await new Promise((ok) => setTimeout(ok, 5_000));
  }
  console.log("receipt still registering after 60 s; check the URL above");
});
