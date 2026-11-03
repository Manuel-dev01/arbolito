/**
 * Selling over x402 v2 through Celo's facilitator: Arbolito charges other agents in local
 * stablecoins (wARS, wBRL, wCOP, wMXN, via Permit2) or in dollars (USDT, USDC, USA₮, via EIP-3009).
 * The facilitator settles each payment to `payTo` (the agent wallet that owns ERC-8004 #9976).
 *
 * Rules:
 * - The resource is served before settlement and settled only if the handler succeeded
 *   (@x402/next's withX402); a failed handler cancels the payment, so nothing moves.
 * - The server matches a payment against the price it advertises *now*, amount included. wFIAT
 *   prices are rounded up to two significant figures of the local currency, so a price holds
 *   across small rate moves; a payment that misses a re-priced amount is refused before settling.
 * - Only x402 v2 (`PAYMENT-SIGNATURE`) is accepted. A v1 `X-PAYMENT` header gets an explicit 402
 *   saying so (see `v1Refusal`), never a silent pass.
 */
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { PaymentOption } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { builderCodeResourceServerExtension, declareBuilderCodeExtension, declareEip2612GasSponsoringExtension } from "@x402/extensions";
import { TOKENS } from "@arbolito/config";

export const CELO = "eip155:42220" as const;

export const WFIAT_SELL = ["wARS", "wBRL", "wCOP", "wMXN"] as const;
export const USD_SELL = ["USDT", "USDC", "USAT"] as const;
export type SellSym = (typeof WFIAT_SELL)[number] | (typeof USD_SELL)[number];

/** EIP-712 domains, read onchain with eip712Domain() on 2026-11-03. All support EIP-2612. */
const DOMAIN: Record<SellSym, { name: string; version: string }> = {
  wARS: { name: "Peso Argentino", version: "1" },
  wBRL: { name: "Real Brasileño", version: "1" },
  wCOP: { name: "Peso Colombiano", version: "1" },
  wMXN: { name: "Peso Mexicano", version: "1" },
  USDT: { name: "Tether USD", version: "1" },
  USDC: { name: "USDC", version: "2" },
  USAT: { name: "Tether America USD", version: "1" },
};

/** Local currency per US$ (e.g. { wARS: 1652.4 }). A wFIAT without a rate isn't offered. */
export type FiatRates = Partial<Record<(typeof WFIAT_SELL)[number], number>>;

/** Rounds a positive integer up to `sig` significant decimal digits. */
export function roundUpSig(n: bigint, sig: number): bigint {
  const digits = n.toString().length;
  if (n <= 0n || digits <= sig) return n;
  const unit = 10n ** BigInt(digits - sig);
  return ((n + unit - 1n) / unit) * unit;
}

/**
 * The amount to charge in `sym` (atomic units) for `usdMicros`. Dollar tokens charge the USD
 * price as is; wFIAT converts at `rate` and rounds up to two significant figures.
 */
export function amountFor(sym: SellSym, usdMicros: bigint, rate?: number): bigint | null {
  if ((USD_SELL as readonly string[]).includes(sym)) return usdMicros;
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  // micro-USD × micro-rate = 1e12 scale; × 1e6 → 18 decimals.
  const exact = usdMicros * BigInt(Math.round(rate * 1e6)) * 10n ** 6n;
  return roundUpSig(exact, 2);
}

/** The payment options for one price: local stablecoins first, then dollars. */
export function priceOptions(usdMicros: bigint, rates: FiatRates, payTo: string): PaymentOption[] {
  const out: PaymentOption[] = [];
  for (const sym of [...WFIAT_SELL, ...USD_SELL]) {
    const amount = amountFor(sym, usdMicros, (rates as Record<string, number | undefined>)[sym]);
    if (amount === null) continue;
    const wfiat = (WFIAT_SELL as readonly string[]).includes(sym);
    out.push({
      scheme: "exact",
      network: CELO,
      payTo,
      maxTimeoutSeconds: 120,
      price: {
        asset: TOKENS[sym].address,
        amount: amount.toString(),
        extra: { ...DOMAIN[sym], ...(wfiat ? { assetTransferMethod: "permit2" } : {}) },
      },
    });
  }
  return out;
}

/** Route extensions: our ERC-8021 code for the facilitator to tag settlements, and gasless Permit2 approval. */
export function sellerExtensions(builderCode: string): Record<string, unknown> {
  return { "builder-code": declareBuilderCodeExtension(builderCode), ...declareEip2612GasSponsoringExtension() };
}

export interface Sale {
  resource: string;
  payer: string;
  asset: string;
  amount: string;
  payTo: string;
  txHash: string;
}

/** The symbol for a token address we sell in, or the address itself. */
export function sellSymbol(address: string): string {
  const hit = [...WFIAT_SELL, ...USD_SELL].find((s) => TOKENS[s].address.toLowerCase() === address.toLowerCase());
  return hit ?? address;
}

export interface SellerConfig {
  facilitatorUrl: string;
  /** Celo's facilitator needs an API key for /settle (sent as X-API-Key). */
  apiKey?: string;
  onSale: (s: Sale) => Promise<void>;
}

export function createSeller(c: SellerConfig): x402ResourceServer {
  const auth = c.apiKey ? { "X-API-Key": c.apiKey } : undefined;
  const facilitator = new HTTPFacilitatorClient({
    url: c.facilitatorUrl,
    timeoutMs: 30_000,
    ...(auth ? { createAuthHeaders: async () => ({ verify: auth, settle: auth, supported: auth }) } : {}),
  });
  const server = new x402ResourceServer(facilitator).register(CELO, new ExactEvmScheme()).registerExtension(builderCodeResourceServerExtension);
  server.onAfterSettle(async ({ result, requirements, paymentPayload }) => {
    if (!result.success || !result.transaction) return;
    const resource = (paymentPayload as { resource?: { url?: string } }).resource?.url ?? "";
    await c
      .onSale({
        resource,
        payer: result.payer ?? "",
        asset: requirements.asset,
        amount: requirements.amount,
        payTo: requirements.payTo,
        txHash: result.transaction,
      })
      // Recording must never fail a settled sale; the chain is the record of last resort.
      .catch((e) => console.error(`[x402] settled ${result.transaction} but recording it failed: ${(e as Error).message}`));
  });
  return server;
}

/** The explicit answer to an x402 v1 `X-PAYMENT` request: we speak v2 only. Nothing is settled. */
export function v1Refusal(): Response {
  return Response.json(
    { x402Version: 2, error: "x402 v1 (X-PAYMENT) is not accepted here; request without payment for the v2 402 and pay with PAYMENT-SIGNATURE" },
    { status: 402 },
  );
}
