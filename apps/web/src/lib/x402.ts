import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { insertX402Sale } from "@arbolito/db";
import { createSeller, priceOptions, sellerExtensions, sellSymbol, v1Refusal, type FiatRates } from "@arbolito/x402/seller";
import { AGENT_WALLET } from "./agent-registration";
import { webDb } from "./data";
import { loadFiatRates } from "./desk";
import { ApiFailure, upstream } from "./miniapp/server/errors";
import { errorResponse, logError } from "./miniapp/server/http";

/**
 * Arbolito's paid API for other agents (x402 v2, Celo's facilitator). Each route names its price
 * in US$; the 402 offers it in wARS, wBRL, wCOP and wMXN at the desk's rate, and in USDT, USDC
 * and USA₮. Settled sales land in `x402_sales`. Server only.
 */

export interface PaidRoute {
  /** Price in micro-USD. */
  usdMicros: bigint;
  description: string;
  mimeType?: string;
  /** Checked before the 402, so a bad request is refused without asking for payment. */
  validate?: (req: NextRequest) => NextResponse | null;
}

const payTo = () => process.env.X402_PAY_TO || AGENT_WALLET;
const BUILDER_CODE = process.env.ATTRIBUTION_CODE || "celo_e054d92430a5";

let seller: ReturnType<typeof createSeller> | undefined;
function getSeller() {
  seller ??= createSeller({
    facilitatorUrl: process.env.X402_FACILITATOR_URL || "https://api.x402.celo.org",
    apiKey: process.env.X402_API_KEY || undefined,
    onSale: async (s) => {
      const db = webDb();
      if (!db) return;
      const resource = new URL(s.resource, "https://x").pathname;
      await insertX402Sale(db, {
        resource,
        payer: s.payer.toLowerCase(),
        asset: sellSymbol(s.asset),
        assetAddress: s.asset.toLowerCase(),
        amount: s.amount,
        usdMicros: (SALE_PRICES.get(resource) ?? 0n).toString(),
        payTo: s.payTo.toLowerCase(),
        txHash: s.txHash,
      });
    },
  });
  return seller;
}

/** The US$ price per paid path, for the sale record. */
const SALE_PRICES = new Map<string, bigint>();

// Rates are held 10 minutes: prices must not move between a 402 and its payment.
let rates: { at: number; value: FiatRates } | undefined;
async function currentRates(): Promise<FiatRates> {
  if (rates && Date.now() - rates.at < 10 * 60_000) return rates.value;
  const fresh = await loadFiatRates();
  if (fresh && Object.keys(fresh).length) rates = { at: Date.now(), value: fresh };
  return rates?.value ?? {};
}

type Handler = (req: NextRequest) => Promise<NextResponse>;

/** A failing handler answers with its error, never a 2xx, so withX402 cancels the payment. */
const guarded =
  (handler: Handler): Handler =>
  async (req) => {
    try {
      return await handler(req);
    } catch (err) {
      if (!(err instanceof ApiFailure)) logError(`x402 ${req.nextUrl.pathname}`, err);
      return errorResponse(err instanceof ApiFailure ? err : upstream()) as NextResponse;
    }
  };

/**
 * Wraps a GET handler behind x402. One wrapped handler per distinct price list, so the
 * facilitator's /supported is read once per price change, not per request.
 */
export function paid(route: PaidRoute, handler: Handler): Handler {
  const wrapped = new Map<string, Handler>();
  return async (req) => {
    if (req.headers.get("x-payment") && !req.headers.get("payment-signature")) return v1Refusal() as NextResponse;
    const invalid = route.validate?.(req);
    if (invalid) return invalid;
    const accepts = priceOptions(route.usdMicros, await currentRates(), payTo());
    const key = JSON.stringify(accepts.map((a) => a.price));
    let h = wrapped.get(key);
    if (!h) {
      h = withX402(
        guarded(handler),
        {
          accepts,
          description: route.description,
          mimeType: route.mimeType ?? "application/json",
          serviceName: "Arbolito",
          extensions: sellerExtensions(BUILDER_CODE),
        },
        getSeller(),
      ) as Handler;
      wrapped.set(key, h);
    }
    SALE_PRICES.set(req.nextUrl.pathname, route.usdMicros);
    return h(req);
  };
}
