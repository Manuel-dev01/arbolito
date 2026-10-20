/**
 * Arbolito's buy payer: a small hot wallet that pays buy's x402 services in USDT.
 *
 *   pnpm buy init                         create BUY_PAYER_PRIVATE_KEY in .env if empty (prints the address)
 *   pnpm buy fund <usdt> [--fork <rpc> | --live]   ops sends USDT to the payer (tagged; ≤ 2 USDT)
 *   pnpm buy quote [--minutes 2]          the free 402 for a browser session
 *   pnpm buy browser [--minutes 2] --live pay for one browser session (founder go-ahead first)
 *   pnpm buy rates --live                 one Western Union refresh by hand (what the bot does every 6 h)
 *
 * The session's response can hold bearer URLs: they're redacted in the output and the full body
 * is written to .arbolito/buy/ (gitignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeFunctionData, formatUnits, parseUnits, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { TOKENS, findRepoRoot, loadEnv, txUrl } from "@arbolito/config";
import { FileLedger, MemoryLedger, capsFromEnv, makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { erc20Abi } from "@arbolito/router";
import { payRequest, quoteRequest } from "@arbolito/x402";
import { closeDb, getDb } from "@arbolito/db";
import { refreshWesternUnion } from "../apps/agent/src/competitors";
import { confirm, flagValue, forkUrl, hasFlag, opsAccount, positional, runMain } from "./lib/cli";

const MAX_FUND = parseUnits("2", 6);
/** Never pay more than this for one call, whatever the 402 says (a browser minute is < 1 cent). */
const MAX_CALL = 50_000n; // US$ 0.05

/** Long tokens and URLs with credentials are bearer capabilities: never print them. */
export function redact(v: unknown): unknown {
  if (typeof v === "string") return /^https?:\/\//.test(v) || v.length > 40 ? `<redacted ${v.length} chars>` : v;
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redact(x)]));
  return v;
}

runMain(async () => {
  const [cmd, arg] = positional();
  const env = loadEnv();
  const root = findRepoRoot();

  if (cmd === "init") {
    if (env.BUY_PAYER_PRIVATE_KEY) return console.log(`BUY_PAYER_PRIVATE_KEY already set: ${privateKeyToAccount(env.BUY_PAYER_PRIVATE_KEY as Hex).address}`);
    const file = join(root, ".env");
    const text = readFileSync(file, "utf8");
    const key = generatePrivateKey();
    const next = /^BUY_PAYER_PRIVATE_KEY=\s*$/m.test(text) ? text.replace(/^BUY_PAYER_PRIVATE_KEY=\s*$/m, `BUY_PAYER_PRIVATE_KEY=${key}`) : `${text}\nBUY_PAYER_PRIVATE_KEY=${key}\n`;
    writeFileSync(file, next);
    return console.log(`Created the buy payer: ${privateKeyToAccount(key).address} (key written to .env, not printed)`);
  }

  if (!env.BUY_PAYER_PRIVATE_KEY) throw new Error("Run `pnpm buy init` first");
  const payer = privateKeyToAccount(env.BUY_PAYER_PRIVATE_KEY as Hex);
  const token = TOKENS[env.BUY_PAY_TOKEN];
  const fork = forkUrl();
  const live = hasFlag("live");

  if (cmd === "fund") {
    const value = parseUnits(arg ?? "", 6);
    if (value <= 0n || value > MAX_FUND) throw new Error("usage: pnpm buy fund <usdt ≤ 2> [--fork <rpc> | --live]");
    const clientOpts = fork ? { rpcUrl: fork, pollingInterval: 200 } : {};
    const publicClient = makePublicClient(clientOpts);
    const ops = opsAccount();
    const bal = (who: Address) => publicClient.readContract({ address: TOKENS.USDT.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [who] });
    console.log(`ops ${ops.address} (${formatUnits(await bal(ops.address), 6)} USDT) → buy payer ${payer.address} (${formatUnits(await bal(payer.address), 6)} USDT): ${arg} USDT`);
    if (!fork && !live) return console.log("Plan only. --fork <rpc> to rehearse, --live after the go-ahead.");
    if (live && !(await confirm("\nThis sends USDT from the ops wallet on Celo mainnet.", "send"))) return console.log("Aborted. Nothing was sent.");
    const r = await sendGuarded({
      mode: fork ? "fork" : "live",
      live,
      publicClient,
      walletClient: makeWalletClient(ops, clientOpts),
      to: TOKENS.USDT.address as Address,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [payer.address, value] }),
      usdMicros: value,
      purpose: "fund the buy payer",
      ledger: fork ? new MemoryLedger() : new FileLedger(),
    });
    return console.log(`sent: ${fork ? r.hash : txUrl(r.hash)}`);
  }

  if (cmd === "rates") {
    if (!live) return console.log("Re-run with --live to pay for one browser session (~US$ 0.0042) and refresh Western Union rates.");
    try {
      const r = await refreshWesternUnion(getDb(), env, { force: true });
      console.log(`paid tx: ${r.paymentTx ? txUrl(r.paymentTx) : "(none)"}`);
      for (const x of r.stored) console.log(`  ${x.corridor}: ${x.rate.toFixed(4)} (${x.sendAmount} → ${x.receiveAmount})`);
      for (const e of r.errors) console.log(`  error: ${e}`);
    } finally {
      await closeDb();
    }
    return;
  }

  const minutes = Number(flagValue("minutes") ?? 2);
  const request = { url: `${env.BUY_GATEWAY_URL.replace(/\/$/, "")}/v1/browser/sessions`, method: "POST" as const, body: { durationMinutes: minutes } };
  const quote = await quoteRequest(request, token.address);
  console.log(`buy browser session, ${minutes} min: ${formatUnits(quote.amount, token.decimals)} ${env.BUY_PAY_TOKEN} to ${quote.requirement.payTo} (payer ${payer.address})`);
  if (cmd === "quote") return;
  if (cmd !== "browser") throw new Error("usage: pnpm buy <init|fund|quote|browser|rates>");
  if (!live) return console.log("Quote only. Re-run with --live to pay (founder go-ahead first).");
  if (!(await confirm(`\nThis pays ${formatUnits(quote.amount, token.decimals)} ${env.BUY_PAY_TOKEN} on Celo mainnet.`, "pay"))) return console.log("Aborted. Nothing was paid.");

  const paid = await payRequest(request, { account: payer, quote, maxAmount: MAX_CALL, ledger: new FileLedger(), caps: capsFromEnv(), purpose: `buy browser.sessions.create ${minutes}m` });
  const dir = join(root, ".arbolito", "buy");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `browser-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ settlement: paid.settlement, body: paid.body }, null, 2));
  console.log(`paid ${formatUnits(paid.amount, token.decimals)} ${env.BUY_PAY_TOKEN}; settlement ${paid.settlement?.transaction ? txUrl(paid.settlement.transaction) : "(no X-PAYMENT-RESPONSE)"}`);
  console.log(`response (redacted): ${JSON.stringify(redact(paid.body), null, 2)}`);
  console.log(`full response saved to ${file} (gitignored; holds bearer URLs)`);
});
