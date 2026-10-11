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

/**
 * A transaction that was broadcast but did not confirm successfully. Carries the hash so the
 * caller can check the chain instead of guessing (and never blindly re-sends).
 * - reverted:    mined and reverted; nothing moved but gas
 * - unconfirmed: no receipt within the timeout; it may still land
 */
export class BroadcastError extends Error {
  constructor(
    message: string,
    readonly hash: Hex,
    readonly outcome: "reverted" | "unconfirmed",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BroadcastError";
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
  /** Omit to deploy a contract (data = initcode; the suffix trails the constructor args harmlessly). */
  to?: Address;
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
 * waitForTransactionReceipt that survives transient RPC errors until the deadline. Read-only,
 * so retrying is safe; it never re-sends. Why: on mainnet a forno blip right after broadcast
 * made a landed tx look failed ("RPC Request failed" for 0x4706ee55…, which succeeded).
 */
export async function waitForReceiptResilient(client: PublicClient, hash: Hex, timeoutMs: number): Promise<TransactionReceipt> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw lastErr ?? new Error(`No receipt for ${hash} within ${timeoutMs} ms`);
    try {
      return await client.waitForTransactionReceipt({ hash, timeout: remaining });
    } catch (err) {
      lastErr = err;
      if ((err as Error).name === "WaitForTransactionReceiptTimeoutError") throw err;
      await new Promise((r) => setTimeout(r, Math.min(3_000, Math.max(0, deadline - Date.now()))));
    }
  }
}

/**
 * Gas estimate (which simulates the call), retried a few times. Read-only, so retrying is safe.
 * Why: forno is load-balanced; right after our previous tx (e.g. an approve) a node that hasn't
 * seen it yet makes the next call revert (we hit "STF" on mainnet). A genuine revert still fails
 * after the last attempt. Returns the estimate plus a 20% buffer.
 */
export async function simulateWithRetry(
  client: PublicClient,
  tx: Parameters<PublicClient["estimateGas"]>[0],
  purpose: string,
  attempts = 4,
  baseDelayMs = 1_500,
): Promise<bigint> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const est = await client.estimateGas(tx);
      return (est * 12n) / 10n;
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        const msg = (err as { shortMessage?: string }).shortMessage ?? (err as Error).message;
        log(`[sim] ${purpose}: attempt ${i} reverted (${msg.slice(0, 80)}); retrying`);
        await new Promise((r) => setTimeout(r, baseDelayMs * i));
      }
    }
  }
  throw lastErr;
}

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
  checkCaps(p.usdMicros, await ledger.spent(day), caps);

  const data = withAttribution(p.data, code);
  const feeCurrency = p.feeCurrency ? feeCurrencyFor(p.feeCurrency) : undefined;
  const tx = { account, ...(p.to ? { to: p.to } : {}), data, value: p.value ?? 0n, ...(feeCurrency ? { feeCurrency } : {}) };

  // Simulate first (estimateGas executes the call): a revert here costs nothing.
  const gas = await simulateWithRetry(p.publicClient, tx, p.purpose);

  const id = randomUUID();
  await ledger.reserve(day, { id, at: now.toISOString(), purpose: p.purpose, usdMicros: p.usdMicros.toString() });
  let hash: Hex;
  try {
    // Pass the simulated gas so signing doesn't re-estimate against a possibly lagging node.
    hash = await p.walletClient.sendTransaction({ ...tx, gas, chain: p.walletClient.chain ?? null } as never);
  } catch (err) {
    // Nothing was broadcast, so nothing moved.
    await ledger.update(day, id, { status: "released" });
    throw err;
  }
  await ledger.update(day, id, { status: "sent", txHash: hash });
  log(`[${p.mode}] ${p.purpose}: sent ${p.mode === "live" ? txUrl(hash) : hash} (${formatUsd(p.usdMicros)})`);

  let receipt: TransactionReceipt;
  try {
    receipt = await waitForReceiptResilient(p.publicClient, hash, 120_000);
  } catch (err) {
    // Broadcast but unconfirmed: keep the reservation (it may still land) and hand back the hash.
    const msg = (err as { shortMessage?: string }).shortMessage ?? (err as Error).message;
    throw new BroadcastError(`Transaction ${hash} unconfirmed: ${msg}`, hash, "unconfirmed", err);
  }
  if (receipt.status !== "success") {
    await ledger.update(day, id, { status: "released" });
    throw new BroadcastError(`Transaction reverted: ${hash}`, hash, "reverted");
  }
  await ledger.update(day, id, { status: "confirmed" });
  return { hash, receipt, data };
}
