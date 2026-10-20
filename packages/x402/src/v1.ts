/**
 * x402 v1 "exact" (EIP-3009) on Celo, as buy's gateway speaks it (docs/04-reference.md):
 * an unpaid request answers 402 with `accepts`; the client signs a TransferWithAuthorization for
 * the exact amount to `payTo` and resends with the `X-PAYMENT` header; the gateway settles it
 * onchain and answers with `X-PAYMENT-RESPONSE` (the settlement transaction).
 *
 * Money rules (CLAUDE.md): the free 402 is the quote, shown before paying; a non-402 answer to
 * an unpaid request is an error, never a success; a paid request that fails or times out is
 * never retried (the payment may have settled).
 */
import { getAddress, toHex, type Address, type Hex, type LocalAccount } from "viem";
import { z } from "zod";

export const Requirement = z.object({
  scheme: z.literal("exact"),
  network: z.string(),
  maxAmountRequired: z.string().regex(/^\d+$/),
  resource: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
  payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  maxTimeoutSeconds: z.number().int().positive(),
  asset: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  extra: z.object({ name: z.string(), version: z.string() }).passthrough(),
});
export type Requirement = z.infer<typeof Requirement>;

export const Challenge = z.object({ x402Version: z.literal(1), accepts: z.array(Requirement).min(1), error: z.string().optional() });
export type Challenge = z.infer<typeof Challenge>;

/** X-PAYMENT-RESPONSE, decoded. */
export const Settlement = z
  .object({ success: z.boolean(), transaction: z.string().optional(), network: z.string().optional(), payer: z.string().optional() })
  .passthrough();
export type Settlement = z.infer<typeof Settlement>;

export interface ExactPayload {
  x402Version: 1;
  scheme: "exact";
  network: string;
  payload: {
    signature: Hex;
    authorization: { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
  };
}

const CHAIN_IDS: Record<string, number> = { celo: 42220 };

const TRANSFER_WITH_AUTHORIZATION = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

/** The requirement for `asset` (case-insensitive), or undefined. */
export function pickRequirement(c: Challenge, asset: string): Requirement | undefined {
  return c.accepts.find((r) => r.asset.toLowerCase() === asset.toLowerCase());
}

/** Signs an EIP-3009 TransferWithAuthorization for exactly what the requirement asks. */
export async function signExact(account: LocalAccount, req: Requirement, o: { nowSecs: number; nonce: Hex }): Promise<ExactPayload> {
  const chainId = CHAIN_IDS[req.network];
  if (!chainId) throw new Error(`unsupported x402 network ${req.network}`);
  const authorization = {
    from: account.address,
    to: getAddress(req.payTo),
    value: req.maxAmountRequired,
    // A minute of clock skew either way; valid only for the gateway's own timeout.
    validAfter: String(o.nowSecs - 60),
    validBefore: String(o.nowSecs + req.maxTimeoutSeconds),
    nonce: o.nonce,
  };
  const signature = await account.signTypedData({
    domain: { name: req.extra.name, version: req.extra.version, chainId, verifyingContract: getAddress(req.asset) },
    types: { TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION },
    primaryType: "TransferWithAuthorization",
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });
  return { x402Version: 1, scheme: "exact", network: req.network, payload: { signature, authorization } };
}

export const encodeXPayment = (p: ExactPayload) => Buffer.from(JSON.stringify(p)).toString("base64");

export function decodeSettlement(header: string | null): Settlement | null {
  if (!header) return null;
  try {
    return Settlement.parse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
  } catch {
    return null;
  }
}

/** 32 random bytes for the authorization nonce. */
export function randomNonce(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b);
}
