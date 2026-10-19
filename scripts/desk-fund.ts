/**
 * One-off: set up the Arbolito Desk wallet from the founder's 40 USDT (approved 2026-10-15).
 *   pnpm desk:fund                     quotes only (no transaction)
 *   pnpm desk:fund --fork <rpc>        rehearse every step on an anvil fork
 *   pnpm desk:fund --live [--yes]      Celo mainnet
 *   --only USDC,USAT                   limit inventory swaps to these soft assets (approvals still cover all)
 *
 * Resumable: it does only what is still missing. (The first live run, 2026-10-15, stopped after
 * the wARS swaps: a lagging node hid an allowance the previous swap had spent; see minBlock.)
 * 1. Gas: CELO from the ops wallet, sized from the current gas price for the remaining steps.
 * 2. Inventory: 5 USDT swaps until each soft side reaches its cap (at most 2 per token), best
 *    executable route each, quoted and shown first. 5 USDT per swap stays within the per-action cap.
 * 3. Permit2: bounded ERC20 approvals from the desk wallet (2× the corridor caps, never max), so
 *    Stitch can settle fills. Gas-only, tagged like every Arbolito tx.
 * Every send goes through sendGuarded (caps, simulation, ERC-8021 suffix). Nothing is retried.
 */
import { erc20Abi, encodeFunctionData, formatUnits, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, TOKENS, loadEnv, txUrl } from "@arbolito/config";
import { FileLedger, MemoryLedger, formatUsd, makePublicClient, makeWalletClient, sendGuarded } from "@arbolito/chain";
import { TextileClient, TextileRfqAdapter, UniswapV3Adapter, executableRoutes, executeRoute, fmtAmount, plan, textileFirmEnabled, usdMicros } from "@arbolito/router";
import { LIVE_CORRIDORS as CORRIDORS } from "@arbolito/desk";
import { confirm, flagValue, forkUrl, hasFlag, opsAccount, runMain } from "./lib/cli";

const SWAP_USDT = 5_000_000n; // 5 USDT
const MAX_SWAPS_PER_TOKEN = 2;
/** Gas per remaining step, with headroom (measured live: approve ~54k, swap ~130–146k gas). */
const GAS_PER_SWAP = 220_000n;
const GAS_PER_APPROVAL = 60_000n;
const GAS_TOPUP_MAX = parseEther("0.5");
/** Rough CELO price for the cap ledger; deliberately high so the cap check is conservative. */
const CELO_USD_MICROS_PER_CELO = 1_000_000n;

runMain(async () => {
  const fork = forkUrl();
  const live = hasFlag("live");
  if (fork && live) throw new Error("Pass either --live or --fork, not both");
  const execute = !!fork || live;
  const mode = fork ? "fork" : "live";
  const env = loadEnv();
  if (!env.DESK_PRIVATE_KEY) throw new Error("DESK_PRIVATE_KEY is not set");
  const desk = privateKeyToAccount(env.DESK_PRIVATE_KEY as Hex);
  const ops = opsAccount();
  const clientOpts = fork ? { rpcUrl: fork, pollingInterval: 200 } : {};
  const publicClient = makePublicClient(clientOpts);
  const deskWallet = makeWalletClient(desk, clientOpts);
  const opsWallet = makeWalletClient(ops, clientOpts);
  const ledger = fork ? new MemoryLedger() : new FileLedger();
  const where = (h: string) => (fork ? h : txUrl(h));
  const bal = (s: keyof typeof TOKENS) => publicClient.readContract({ address: TOKENS[s].address as Address, abi: erc20Abi, functionName: "balanceOf", args: [desk.address] });
  const show = async (label: string) =>
    console.log(
      `${label}: desk ${desk.address} CELO=${formatUnits(await publicClient.getBalance({ address: desk.address }), 18)} ` +
        `USDT=${formatUnits(await bal("USDT"), 6)} wARS=${formatUnits(await bal("wARS"), 18)} wBRL=${formatUnits(await bal("wBRL"), 18)}`,
    );

  console.log(`Desk funding on ${fork ? `anvil fork ${fork}` : "Celo mainnet"}${execute ? "" : " (QUOTES ONLY)"}`);
  await show("before");

  // ── the whole plan, quoted, before anything moves
  const usdt = TOKENS.USDT.address as Address;
  const textileFirm = textileFirmEnabled();
  const only = flagValue("only")?.split(",").map((s) => s.trim().toLowerCase());
  const swaps: (typeof CORRIDORS)[number]["soft"][] = [];
  for (const c of CORRIDORS) {
    if (only && !only.includes(c.soft.toLowerCase())) continue;
    const planned = await plan({
      client: publicClient,
      adapters: [new UniswapV3Adapter(publicClient), new TextileRfqAdapter(undefined, undefined, 6_000)],
      tokenIn: usdt,
      tokenOut: TOKENS[c.soft].address as Address,
      amountIn: SWAP_USDT,
      taker: desk.address,
    });
    const route = executableRoutes(planned, { textileFirm })[0];
    if (!route) throw new Error(`no executable route for USDT → ${c.soft}`);
    const have = await bal(c.soft);
    const n = have >= (c.sellCapSoft * 99n) / 100n ? 0 : Math.min(MAX_SWAPS_PER_TOKEN, Number((c.sellCapSoft - have + route.expectedOut - 1n) / route.expectedOut));
    for (let i = 0; i < n; i++) swaps.push(c.soft);
    const alts = [planned.best, ...planned.alternatives].filter((r) => r && r !== route).map((r) => `${r!.label} → ${fmtAmount(r!.tokenOut, r!.expectedOut)}`);
    console.log(
      `${c.soft}: holds ${fmtAmount(route.tokenOut, have)}, cap ${fmtAmount(route.tokenOut, c.sellCapSoft)} → ${n} swap(s); ` +
        `5 USDT → ${route.label} expected ${fmtAmount(route.tokenOut, route.expectedOut)} (min ${fmtAmount(route.tokenOut, route.minOut)})` +
        (alts.length ? `\n  alternatives: ${alts.join("; ")}` : ""),
    );
  }
  const approvals = [
    { sym: "USDT" as const, amount: 2n * CORRIDORS.reduce((s, c) => s + c.buyCapUsdt, 0n) },
    ...CORRIDORS.map((c) => ({ sym: c.soft, amount: 2n * c.sellCapSoft })),
  ];
  console.log(`then Permit2 approvals (where missing): ${approvals.map((a) => `${a.sym} ${formatUnits(a.amount, TOKENS[a.sym].decimals)}`).join(", ")}`);
  const gasPrice = await publicClient.getGasPrice();
  const gasNeed = (gasPrice * (BigInt(swaps.length) * GAS_PER_SWAP + BigInt(approvals.length) * GAS_PER_APPROVAL) * 3n) / 2n;
  const celoNow = await publicClient.getBalance({ address: desk.address });
  const cent = 10n ** 16n; // 0.01 CELO
  const topUp = celoNow >= gasNeed ? 0n : ((gasNeed - celoNow + cent - 1n) / cent) * cent;
  if (topUp > GAS_TOPUP_MAX) throw new Error(`gas top-up of ${formatUnits(topUp, 18)} CELO exceeds the ${formatUnits(GAS_TOPUP_MAX, 18)} limit (gas price ${formatUnits(gasPrice, 9)} gwei)`);
  console.log(`gas: ${formatUnits(gasPrice, 9)} gwei, need ~${formatUnits(gasNeed, 18)} CELO, desk has ${formatUnits(celoNow, 18)} → top-up ${formatUnits(topUp, 18)} CELO from ops`);
  if (!execute) {
    console.log("\nQuotes only. Re-run with --fork <rpc> to rehearse, or --live once approved.");
    return;
  }
  const summary = `${formatUnits(topUp, 18)} CELO gas, ${swaps.length} × 5 USDT swaps, Permit2 approvals where missing`;
  if (!(await confirm(`${fork ? "Rehearse on the fork" : "Send on Celo mainnet"}: ${summary}.`))) {
    console.log("Aborted. Nothing was sent.");
    return;
  }

  // Newest confirmed block: every later allowance read must be at least this fresh.
  let minBlock = await publicClient.getBlockNumber();

  // 1. gas
  if (topUp > 0n) {
    const r = await sendGuarded({ mode, live, publicClient, walletClient: opsWallet, to: desk.address, value: topUp, usdMicros: (topUp * CELO_USD_MICROS_PER_CELO) / 10n ** 18n, purpose: `desk gas (${formatUnits(topUp, 18)} CELO from ops)`, ledger });
    minBlock = r.receipt.blockNumber;
    console.log(`gas sent: ${where(r.hash)}`);
  } else console.log("gas: desk already has enough CELO");

  // 2. swaps, each re-planned at execution so the quote is current
  for (const sym of swaps) {
    const planned = await plan({ client: publicClient, adapters: [new UniswapV3Adapter(publicClient), new TextileRfqAdapter(undefined, undefined, 6_000)], tokenIn: usdt, tokenOut: TOKENS[sym].address as Address, amountIn: SWAP_USDT, taker: desk.address });
    const route = executableRoutes(planned, { textileFirm })[0];
    if (!route) throw new Error(`no executable route for USDT → ${sym}; stopping (nothing retried)`);
    const value = await usdMicros(publicClient, usdt, SWAP_USDT, planned.blockNumber);
    console.log(`swap 5 USDT → ${sym} via ${route.label}, expected ${fmtAmount(route.tokenOut, route.expectedOut)} (~${formatUsd(value)})`);
    const hasTextile = route.legs.some((l) => l.quote.venue === "textile_rfq");
    const res = await executeRoute({
      route,
      taker: desk.address,
      account: desk,
      publicClient,
      walletClient: deskWallet,
      mode,
      live: !fork,
      ledger,
      textile: hasTextile ? new TextileClient() : undefined,
      usdValue: value,
      minBlock,
      onProgress: (e) => console.log(`  [${e.venue}] ${e.stage}: ${e.message}${e.txHash ? ` ${where(e.txHash)}` : ""}`),
    });
    for (const w of res.warnings) console.log(`  warning: ${w}`);
    if (res.status !== "complete") throw new Error(`swap ${res.status}: ${res.error?.message}; stopping, nothing retried. Check the desk wallet onchain.`);
    minBlock = res.legs.at(-1)!.blockNumber;
    console.log(`  received ${fmtAmount(route.tokenOut, res.finalAmountOut)}`);
  }

  // 3. Permit2 approvals (bounded), skipped where a fresh read shows they're already in place
  for (const a of approvals) {
    let current: bigint | undefined;
    for (let i = 0; i < 5 && current === undefined; i++) {
      const head = await publicClient.getBlockNumber({ cacheTime: 0 });
      if (head >= minBlock)
        current = await publicClient.readContract({ address: TOKENS[a.sym].address as Address, abi: erc20Abi, functionName: "allowance", args: [desk.address, CONTRACTS.permit2 as Address], blockNumber: head });
      else await new Promise((r) => setTimeout(r, 1_000));
    }
    if (current !== undefined && current >= a.amount) {
      console.log(`Permit2 already approved for ${a.sym}`);
      continue;
    }
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [CONTRACTS.permit2 as Address, a.amount] });
    const r = await sendGuarded({ mode, live, publicClient, walletClient: deskWallet, to: TOKENS[a.sym].address as Address, data, usdMicros: 0n, purpose: `desk Permit2 approval ${a.sym}`, ledger });
    minBlock = r.receipt.blockNumber;
    console.log(`approved Permit2 for ${formatUnits(a.amount, TOKENS[a.sym].decimals)} ${a.sym}: ${where(r.hash)}`);
  }
  await show("after");
});
