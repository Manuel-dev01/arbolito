import { NextResponse, type NextRequest } from "next/server";
import { Sym } from "../../../../lib/miniapp/contract";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { parseAmount, planQuote, QUOTE_TTL_MS, toQuoteResponse } from "../../../../lib/miniapp/server/quote";
import { paid } from "../../../../lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function params(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const from = Sym.safeParse(q.get("from"));
  const to = Sym.safeParse(q.get("to"));
  const amount = q.get("amount") ?? "";
  if (!from.success || !to.success || from.data === to.data || !/^\d+(\.\d+)?$/.test(amount)) return null;
  try {
    const amountIn = parseAmount(from.data, amount);
    return amountIn > 0n ? { from: from.data, to: to.data, amountIn } : null;
  } catch {
    return null;
  }
}

const usage = () =>
  NextResponse.json(
    { error: "bad_request", message: `Use ?from=&to=&amount= with from/to in ${Sym.options.join(", ")} (they must differ) and a positive amount in human units.` },
    { status: 400 },
  );

/**
 * GET /api/x402/quote?from=USDT&to=wARS&amount=100 (US$ 0.01): Arbolito's best route across
 * Textile RFQ and Uniswap v3 on Celo, with the alternatives, how it compares with the official
 * rate and with Western Union, and every reference used. Read-only: nothing is executed.
 */
export const GET = paid(
  { usdMicros: 10_000n, description: "Best route across Textile RFQ and Uniswap v3 on Celo for a LatAm stablecoin conversion, vs official and Western Union", validate: (req) => (params(req) ? null : usage()) },
  async (req) => {
    const p = params(req)!;
    const q = await planQuote(getDeps(), p.from, p.to, p.amountIn);
    return NextResponse.json(toQuoteResponse({ id: `x402-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + QUOTE_TTL_MS) }, q));
  },
);
