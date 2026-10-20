/**
 * Paying for one x402 v1 request: quote (free 402), check the price against our own limits and
 * the spend caps, sign, send once, record. Never retries a paid request.
 */
import type { LocalAccount } from "viem";
import { checkCaps, type Caps, type SpendLedger } from "@arbolito/chain";
import { Challenge, decodeSettlement, encodeXPayment, pickRequirement, randomNonce, signExact, type Requirement, type Settlement } from "./v1";

export interface PaidRequest {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
}

export interface Quote {
  requirement: Requirement;
  /** Atomic units of the requirement's asset (6 decimals for USDT/USDC/USA₮). */
  amount: bigint;
}

export class NotPaywalledError extends Error {}
export class PriceTooHighError extends Error {}
/** The payment was rejected before settling (the gateway answered 402 again): nothing moved. */
export class PaymentRejectedError extends Error {}
/** We can't tell whether the payment settled: the reservation stays and nothing is retried. */
export class PaymentUncertainError extends Error {}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const init = (r: PaidRequest, headers: Record<string, string> = {}): RequestInit => ({
  method: r.method ?? "POST",
  headers: { "content-type": "application/json", ...headers },
  ...(r.body === undefined ? {} : { body: JSON.stringify(r.body) }),
});

/** The free 402 for exactly this request, in `asset`. A non-402 answer is an error (CLAUDE.md). */
export async function quoteRequest(r: PaidRequest, asset: string, f: FetchLike = fetch): Promise<Quote> {
  const res = await f(r.url, { ...init(r), signal: AbortSignal.timeout(20_000) });
  if (res.status !== 402) throw new NotPaywalledError(`${r.url} answered ${res.status} without payment; expected 402`);
  const challenge = Challenge.parse(await res.json());
  const requirement = pickRequirement(challenge, asset);
  if (!requirement) throw new Error(`${r.url} doesn't accept ${asset}`);
  return { requirement, amount: BigInt(requirement.maxAmountRequired) };
}

export interface PayOptions {
  account: LocalAccount;
  quote: Quote;
  /** Refuse anything dearer than this (atomic), whatever the 402 says. */
  maxAmount: bigint;
  ledger: SpendLedger;
  caps: Caps;
  purpose: string;
  now?: () => Date;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface Paid {
  status: number;
  body: unknown;
  settlement: Settlement | null;
  amount: bigint;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Pays the quoted request once. The ledger reservation is released only when nothing can have moved. */
export async function payRequest(r: PaidRequest, o: PayOptions): Promise<Paid> {
  const f = o.fetch ?? fetch;
  const now = (o.now ?? (() => new Date()))();
  const amount = o.quote.amount;
  if (amount > o.maxAmount) throw new PriceTooHighError(`price ${amount} is above our limit ${o.maxAmount}`);
  // USD stablecoins at 6 decimals: atomic units are micro-dollars.
  const day = utcDay(now);
  checkCaps(amount, await o.ledger.spent(day), o.caps);
  const id = crypto.randomUUID();
  await o.ledger.reserve(day, { id, at: now.toISOString(), purpose: o.purpose, usdMicros: amount.toString() });

  const payment = await signExact(o.account, o.quote.requirement, { nowSecs: Math.floor(now.getTime() / 1000), nonce: randomNonce() });
  let res: Response;
  try {
    res = await f(r.url, { ...init(r, { "X-PAYMENT": encodeXPayment(payment) }), signal: AbortSignal.timeout(o.timeoutMs ?? 60_000) });
  } catch (e) {
    throw new PaymentUncertainError(`no answer after paying ${r.url} (${(e as Error).message}); check the payer's transfers before trying again`);
  }
  const settlement = decodeSettlement(res.headers.get("x-payment-response"));
  if (res.status === 402) {
    await o.ledger.update(day, id, { status: "released" });
    throw new PaymentRejectedError(`payment refused: ${await res.text().catch(() => "")}`.slice(0, 500));
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Paid but failed: the money may have settled. Keep the reservation; report, never retry.
    if (settlement?.transaction) await o.ledger.update(day, id, { status: "sent", txHash: settlement.transaction });
    throw new PaymentUncertainError(`${r.url} answered ${res.status} after payment${settlement?.transaction ? ` (settled in ${settlement.transaction})` : ""}`);
  }
  await o.ledger.update(day, id, { status: "sent", ...(settlement?.transaction ? { txHash: settlement.transaction } : {}) });
  return { status: res.status, body, settlement, amount };
}
