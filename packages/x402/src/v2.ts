/**
 * Paying for one x402 v2 request (`PAYMENT-SIGNATURE`), the version Celo's facilitator speaks:
 * EIP-3009 for USDT/USDC/USA₮ and Permit2 for wARS/wBRL/wCOP/wMXN (with EIP-2612 gas sponsoring,
 * so no approval transaction is needed). Payloads come from the official SDK; the money rules are
 * ours and match the v1 client:
 * - the free 402 is the quote, shown before paying; a non-402 answer to an unpaid request is an error;
 * - the price is checked against our own maximum and the spend caps before signing;
 * - a paid request is sent once and never retried; an unclear outcome keeps the reservation.
 */
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { BuilderCodeClientExtension } from "@x402/extensions";
import type { LocalAccount, PublicClient } from "viem";
import { checkCaps, type Caps, type SpendLedger } from "@arbolito/chain";
import { NotPaywalledError, PaymentRejectedError, PaymentUncertainError, PriceTooHighError } from "./client";

export const CELO_V2 = "eip155:42220";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface V2Quote {
  paymentRequired: PaymentRequired;
  requirement: PaymentRequirements;
  /** Atomic units of the requirement's asset. */
  amount: bigint;
}

const reader = new x402HTTPClient(new x402Client());

/** The free 402 for a GET, in `asset` (address, case-insensitive). A non-402 answer is an error. */
export async function quoteV2(url: string, asset: string, f: FetchLike = fetch): Promise<V2Quote> {
  const res = await f(url, { signal: AbortSignal.timeout(20_000) });
  if (res.status !== 402) throw new NotPaywalledError(`${url} answered ${res.status} without payment; expected 402`);
  const body = await res.json().catch(() => undefined);
  const raw = reader.getPaymentRequiredResponse((h) => res.headers.get(h), body);
  // Some v2 sellers still name the price `maxAmountRequired` (the v1 field): read it as `amount`.
  const paymentRequired = { ...raw, accepts: raw.accepts.map((r) => (r.amount ? r : { ...r, amount: (r as { maxAmountRequired?: string }).maxAmountRequired ?? "" })) };
  const requirement = paymentRequired.accepts.find((r) => r.network === CELO_V2 && r.asset.toLowerCase() === asset.toLowerCase());
  if (!requirement) throw new Error(`${url} doesn't accept ${asset} on Celo`);
  if (!/^\d+$/.test(requirement.amount)) throw new Error(`${url} names no price for ${asset}`);
  return { paymentRequired, requirement, amount: BigInt(requirement.amount) };
}

/** Builds the signed payload for exactly the quoted requirement (nothing is sent). */
export async function signV2(o: { account: LocalAccount; publicClient?: PublicClient; quote: V2Quote; builderCode?: string }): Promise<PaymentPayload> {
  const chosen = o.quote.requirement;
  const client = new x402Client((_version, accepts) => {
    const hit = accepts.find((r) => r.asset === chosen.asset && r.amount === chosen.amount && r.payTo === chosen.payTo);
    if (!hit) throw new Error("the quoted requirement is no longer offered");
    return hit;
  });
  // The SDK's own $1 control can't price wFIAT and drops it; our caps are checked before signing.
  client.setSpendControls(false);
  const signer = toClientEvmSigner(o.account as Parameters<typeof toClientEvmSigner>[0], o.publicClient as Parameters<typeof toClientEvmSigner>[1]);
  registerExactEvmScheme(client, { signer, networks: [CELO_V2] });
  if (o.builderCode) client.registerExtension(new BuilderCodeClientExtension(o.builderCode));
  return client.createPaymentPayload(o.quote.paymentRequired);
}

export interface PayV2Options {
  account: LocalAccount;
  publicClient?: PublicClient;
  quote: V2Quote;
  /** Refuse anything dearer than this (atomic, in the quoted asset), whatever the 402 says. */
  maxAmount: bigint;
  /** The price in micro-USD, checked against the caps and reserved in the ledger. */
  usdMicros: bigint;
  ledger: SpendLedger;
  caps: Caps;
  purpose: string;
  builderCode?: string;
  now?: () => Date;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface PaidV2 {
  status: number;
  body: unknown;
  settlement: SettleResponse | null;
  amount: bigint;
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

function settlementOf(res: Response): SettleResponse | null {
  try {
    return reader.getPaymentSettleResponse((h) => res.headers.get(h));
  } catch {
    return null;
  }
}

/** Pays the quoted GET once. The ledger reservation is released only when nothing can have moved. */
export async function payV2(url: string, o: PayV2Options): Promise<PaidV2> {
  const f = o.fetch ?? fetch;
  const now = (o.now ?? (() => new Date()))();
  const amount = o.quote.amount;
  if (amount > o.maxAmount) throw new PriceTooHighError(`price ${amount} is above our limit ${o.maxAmount}`);
  const day = utcDay(now);
  checkCaps(o.usdMicros, await o.ledger.spent(day), o.caps);
  const id = crypto.randomUUID();
  await o.ledger.reserve(day, { id, at: now.toISOString(), purpose: o.purpose, usdMicros: o.usdMicros.toString() });

  let payload: PaymentPayload;
  try {
    payload = await signV2(o);
  } catch (e) {
    await o.ledger.update(day, id, { status: "released" });
    throw e;
  }
  let res: Response;
  try {
    res = await f(url, { headers: reader.encodePaymentSignatureHeader(payload), signal: AbortSignal.timeout(o.timeoutMs ?? 60_000) });
  } catch (e) {
    throw new PaymentUncertainError(`no answer after paying ${url} (${(e as Error).message}); check the payer's transfers before trying again`);
  }
  const settlement = settlementOf(res);
  if (res.status === 402 && !settlement?.transaction) {
    await o.ledger.update(day, id, { status: "released" });
    throw new PaymentRejectedError(`payment refused: ${await res.text().catch(() => "")}`.slice(0, 500));
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (settlement?.transaction) await o.ledger.update(day, id, { status: "sent", txHash: settlement.transaction });
    throw new PaymentUncertainError(`${url} answered ${res.status} after payment${settlement?.transaction ? ` (settled in ${settlement.transaction})` : ""}`);
  }
  await o.ledger.update(day, id, { status: "sent", ...(settlement?.transaction ? { txHash: settlement.transaction } : {}) });
  return { status: res.status, body, settlement, amount };
}

/**
 * Asks the facilitator whether a payload would pass, without settling it (free, moves nothing).
 * Used to test a seller end to end before any money moves.
 */
export async function verifyV2(facilitatorUrl: string, payload: PaymentPayload, requirement: PaymentRequirements, f: FetchLike = fetch): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }> {
  const res = await f(`${facilitatorUrl.replace(/\/$/, "")}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirement }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { isValid?: boolean; invalidReason?: string; payer?: string };
  return { isValid: Boolean(body.isValid), ...(body.invalidReason ? { invalidReason: body.invalidReason } : {}), ...(body.payer ? { payer: body.payer } : {}) };
}
