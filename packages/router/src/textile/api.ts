import { randomBytes } from "node:crypto";
import { toHex, type Address, type Hex, type LocalAccount } from "viem";
import { z } from "zod";
import { loadEnv } from "@arbolito/config";

/**
 * Textile RFQ API v2 client, coded to openapi-v2.json (docs.textilecredit.com, read 2026-10-09).
 * - preview: free, unauthenticated, reserves nothing
 * - request: firm, taker-bound quote with ready-to-broadcast calldata; keyless callers sign
 *   TakerControl (EIP-712). The venue checks the taker holds the sell token (proof of funds).
 * - submit/status/cancel: authorized by the claimToken (X-Rfq-Claim) or the partner key
 * The taker broadcasts settlement: approval (sell token → quote.spender) then transactions.swap.
 */

const uint = z.string().regex(/^\d+$/);
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);

const routingSchema = z
  .object({ preferenceApplied: z.boolean(), restrictionApplied: z.boolean(), fallbackUsed: z.boolean() })
  .passthrough();

export const previewSchema = z.object({
  data: z
    .object({
      status: z.string(),
      sellAmount: uint.optional(),
      buyAmount: uint.optional(),
      feeAmount: uint.optional(),
      takerPays: uint.optional(),
      rateRay: uint.optional(),
      availableSellAmount: uint.optional(),
      availableBuyAmount: uint.optional(),
      reason: z.string().optional(),
      routing: routingSchema.optional(),
    })
    .passthrough(),
});
export type TextilePreview = z.infer<typeof previewSchema>["data"];

const txSchema = z.object({ to: hex, data: hex, value: z.string(), chainId: z.number().int() });

export const firmSchema = z.object({
  data: z
    .object({
      rfqId: z.string(),
      claimToken: z.string(),
      status: z.enum(["quoted", "no_quote"]),
      reason: z.string().optional(),
      availableSellAmount: uint.optional(),
      retryAfterMs: z.number().int().optional(),
      quote: z
        .object({
          sellAmount: uint,
          buyAmount: uint,
          feeAmount: uint,
          takerPays: uint,
          rateRay: uint,
          expiresAt: z.string(),
          orderDeadline: z.string(),
          reactor: hex,
          spender: hex,
          taker: hex,
          orders: z.array(z.object({ encodedOrder: hex, signature: hex, sellAmount: uint, buyAmount: uint, feeAmount: uint, maker: hex }).passthrough()),
        })
        .passthrough()
        .optional(),
      transactions: z.object({ approval: txSchema.optional(), swap: txSchema }).optional(),
    })
    .passthrough(),
});
export type TextileFirm = z.infer<typeof firmSchema>["data"];

export const statusSchema = z.object({
  data: z
    .object({
      rfqId: z.string(),
      status: z.string(),
      txHash: z.string().optional(),
      sellAmount: uint.optional(),
      buyAmount: uint.optional(),
      failReason: z.string().optional(),
      filledAt: z.string().optional(),
    })
    .passthrough(),
});
export type TextileStatus = z.infer<typeof statusSchema>["data"];

export class TextileApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Textile API ${status}: ${body.slice(0, 300)}`);
    this.name = "TextileApiError";
  }
}

export interface TradeParams {
  chainId: number;
  sellToken: Address;
  buyToken: Address;
  /** Exact input, atomic units. */
  sellAmount: bigint;
}

/** EIP-712 TakerControl: proves the caller controls `taker` (keyless firm requests only). */
export async function signTakerControl(account: LocalAccount, chainId: number, now = Date.now()) {
  const nonce = toHex(randomBytes(32));
  const issuedAt = now; // Unix milliseconds
  const signature = await account.signTypedData({
    domain: { name: "Textile Taker Control", version: "1", chainId },
    types: {
      TakerControl: [
        { name: "taker", type: "address" },
        { name: "chainId", type: "uint256" },
        { name: "nonce", type: "bytes32" },
        { name: "issuedAt", type: "uint256" },
      ],
    },
    primaryType: "TakerControl",
    message: { taker: account.address, chainId: BigInt(chainId), nonce, issuedAt: BigInt(issuedAt) },
  });
  return { nonce, issuedAt, signature };
}

export class TextileClient {
  constructor(
    private readonly base = loadEnv().TEXTILE_API_BASE.replace(/\/$/, ""),
    private readonly apiKey = loadEnv().TEXTILE_API_KEY,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call<T>(path: string, init: RequestInit & { timeoutMs?: number; claim?: string }, schema: z.ZodType<T>): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    if (init.claim) headers["x-rfq-claim"] = init.claim;
    const res = await this.fetchFn(`${this.base}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
    });
    const text = await res.text();
    if (!res.ok) throw new TextileApiError(res.status, text);
    return schema.parse(JSON.parse(text));
  }

  /** Free indicative quote from published maker levels. */
  async preview(p: TradeParams, timeoutMs = 1_500): Promise<TextilePreview> {
    const body = { chainId: p.chainId, sellToken: p.sellToken, buyToken: p.buyToken, sellAmount: p.sellAmount.toString() };
    return (await this.call("/rfq/preview", { method: "POST", body: JSON.stringify(body), timeoutMs }, previewSchema)).data;
  }

  /**
   * Firm, taker-bound quote. Locks real maker inventory for up to ~60s, so only call it when
   * the taker is about to execute. Without a partner key, `account` signs TakerControl.
   * Server may block up to ~70s on a cold corridor; the client waits 75s per the docs.
   */
  async request(p: TradeParams & { taker: Address; account?: LocalAccount }): Promise<TextileFirm> {
    const body: Record<string, unknown> = {
      chainId: p.chainId,
      sellToken: p.sellToken,
      buyToken: p.buyToken,
      sellAmount: p.sellAmount.toString(),
      taker: p.taker,
    };
    if (!this.apiKey) {
      if (!p.account) throw new Error("Keyless firm request needs the taker account to sign TakerControl");
      body.takerProof = await signTakerControl(p.account, p.chainId);
    }
    return (await this.call("/rfq/request", { method: "POST", body: JSON.stringify(body), timeoutMs: 75_000 }, firmSchema)).data;
  }

  /** Report the settlement tx hash. Never retried blindly: check status first on any error. */
  async submit(rfqId: string, claim: string, txHash: Hex): Promise<TextileStatus> {
    return (await this.call(`/rfq/${rfqId}/submit`, { method: "POST", body: JSON.stringify({ txHash }), claim }, statusSchema)).data;
  }

  async status(rfqId: string, claim: string): Promise<TextileStatus> {
    return (await this.call(`/rfq/${rfqId}`, { method: "GET", claim }, statusSchema)).data;
  }

  /** Releases the reserved inventory (does not un-sign the maker's Permit2 order). */
  async cancel(rfqId: string, claim: string): Promise<void> {
    await this.call(`/rfq/${rfqId}/cancel`, { method: "POST", body: "{}", claim }, z.unknown());
  }
}
