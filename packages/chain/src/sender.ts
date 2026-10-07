import { randomUUID } from "node:crypto";
import type { Address, Hex, PublicClient, TransactionReceipt, WalletClient } from "viem";
import { CELO_MAINNET_ID, loadEnv, txUrl } from "@arbolito/config";
import { FORK_ATTRIBUTION_CODE, withAttribution } from "./attribution";
import { isAnvil } from "./clients";
import { feeCurrencyFor } from "./feeCurrency";
import { FileLedger, MemoryLedger, USD, formatUsd, utcDay, type SpendLedger } from "./ledger";
import { log } from "./redact";

export interface Caps {
  maxActionMicros: bigint;
  maxDailyMicros: bigint;
}

export class CapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapExceededError";
  }
}

export class LiveGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveGuardError";
  }
}

export function capsFromEnv(): Caps {
  const env = loadEnv();
  return { maxActionMicros: USD(env.BUILD_MAX_ACTION_USD), maxDailyMicros: USD(env.BUILD_MAX_DAILY_USD) };
}

/** Pure cap check. Throws CapExceededError; returns the new daily total otherwise. */
export function checkCaps(usdMicros: bigint, spentToday: bigint, caps: Caps): bigint {
  if (usdMicros < 0n) throw new Error("usdMicros must be >= 0");
  if (usdMicros > caps.maxActionMicros) {
    throw new CapExceededError(
      `Action of ${formatUsd(usdMicros)} exceeds the per-action cap of ${formatUsd(caps.maxActionMicros)}`,
    );
  }
  const next = spentToday + usdMicros;
  if (next > caps.maxDailyMicros) {
    throw new CapExceededError(
      `Action of ${formatUsd(usdMicros)} would bring today's total to ${formatUsd(next)}, over the daily cap of ${formatUsd(caps.maxDailyMicros)}`,
    );
  }
  return next;
}

export interface GuardedSendParams {
  /** "fork" only talks to anvil; "live" is Celo mainnet and also needs `live: true`. */
  mode: "fork" | "live";
  live?: boolean;
  publicClient: PublicClient;
  walletClient: WalletClient;
  to: Address;
  data?: Hex;
  value?: bigint;
  /** USD value this action moves, in micro-USD. 0 for gas-only calls (approvals, receipts). */
  usdMicros: bigint;
  purpose: string;
  /** Token symbol to pay gas in (mainnet only). */
  feeCurrency?: string;
  attributionCode?: string;
  caps?: Caps;
  ledger?: SpendLedger;
  now?: Date;
}

export interface GuardedSendResult {
  hash: Hex;
  receipt: TransactionReceipt;
  data: Hex;
}

const forkLedger = new MemoryLedger();

/**
 * The only path Arbolito uses to send a transaction. In order:
 * 1. mode guard (fork must be anvil; live needs live=true, chainId 42220, a real attribution code)
 * 2. per-action and daily caps, checked before signing
 * 3. ERC-8021 attribution suffix appended
 * 4. eth_call simulation
 * 5. ledger reservation, send, wait for receipt, ledger update
 */
export async function sendGuarded(p: GuardedSendParams): Promise<GuardedSendResult> {
  const env = loadEnv();
  const account = p.walletClient.account;
  if (!account) throw new Error("walletClient has no account");
  const chainId = await p.publicClient.getChainId();
  const anvil = await isAnvil(p.publicClient);

  let code: string;
  let ledger: SpendLedger;
  if (p.mode === "fork") {
    if (!anvil) throw new LiveGuardError("mode=fork but the RPC is not anvil; refusing to send");
    if (p.feeCurrency) throw new Error("anvil cannot simulate Celo fee-currency txs; pay gas in CELO on the fork");
    code = p.attributionCode ?? env.ATTRIBUTION_CODE ?? FORK_ATTRIBUTION_CODE;
    ledger = p.ledger ?? forkLedger;
  } else {
    if (p.live !== true) throw new LiveGuardError("Mainnet send requires the --live flag");
    if (chainId !== CELO_MAINNET_ID) throw new LiveGuardError(`Expected chainId ${CELO_MAINNET_ID}, got ${chainId}`);
    if (anvil) throw new LiveGuardError("mode=live but the RPC is anvil; use mode=fork");
    const c = p.attributionCode ?? env.ATTRIBUTION_CODE;
    if (!c) throw new LiveGuardError("ATTRIBUTION_CODE is not set; every mainnet tx must carry it");
    code = c;
    ledger = p.ledger ?? new FileLedger();
  }

  const caps = p.caps ?? capsFromEnv();
  const now = p.now ?? new Date();
  const day = utcDay(now);
  checkCaps(p.usdMicros, ledger.spent(day), caps);

  const data = withAttribution(p.data, code);
  const feeCurrency = p.feeCurrency ? feeCurrencyFor(p.feeCurrency) : undefined;
  const tx = { account, to: p.to, data, value: p.value ?? 0n, ...(feeCurrency ? { feeCurrency } : {}) };

  // Simulate first: a revert here costs nothing.
  await p.publicClient.call(tx);

  const id = randomUUID();
  ledger.reserve(day, { id, at: now.toISOString(), purpose: p.purpose, usdMicros: p.usdMicros.toString() });
  let hash: Hex;
  try {
    hash = await p.walletClient.sendTransaction({ ...tx, chain: p.walletClient.chain ?? null } as never);
  } catch (err) {
    // Nothing was broadcast, so nothing moved.
    ledger.update(day, id, { status: "released" });
    throw err;
  }
  ledger.update(day, id, { status: "sent", txHash: hash });
  log(`[${p.mode}] ${p.purpose}: sent ${p.mode === "live" ? txUrl(hash) : hash} (${formatUsd(p.usdMicros)})`);

  const receipt = await p.publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") {
    ledger.update(day, id, { status: "released" });
    throw new Error(`Transaction reverted: ${hash}`);
  }
  ledger.update(day, id, { status: "confirmed" });
  return { hash, receipt, data };
}
