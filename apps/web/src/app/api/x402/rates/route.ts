import { NextResponse } from "next/server";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { loadFiatRates } from "../../../../lib/desk";
import { paid } from "../../../../lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/x402/rates (US$ 0.005): local FX references for agents, in one call. Argentina's
 * official, MEP, CCL and crypto dollars; BRL, COP, MXN and NGN references; Textile and Uniswap mids
 * on Celo; Western Union's rate read through buy; and Arbolito Desk's fair value per currency.
 */
export const GET = paid({ usdMicros: 5_000n, description: "Local FX references (ARS official/MEP/CCL/crypto, BRL, COP, MXN, NGN), Celo market mids, Western Union, and Arbolito Desk's fair values" }, async () => {
  const deps = getDeps();
  const blockNumber = await deps.chain.getBlockNumber();
  const [refs, desk] = await Promise.all([deps.references(blockNumber), loadFiatRates()]);
  return NextResponse.json({
    at: new Date().toISOString(),
    blockNumber: blockNumber.toString(),
    references: refs.references,
    unavailable: refs.unavailable,
    deskFairValue: desk ? Object.fromEntries(Object.entries(desk).map(([sym, rate]) => [`USD/${sym.slice(1)}`, rate])) : null,
  });
});
