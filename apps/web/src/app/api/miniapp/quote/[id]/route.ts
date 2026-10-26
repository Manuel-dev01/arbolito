import type { Address } from "viem";
import { z } from "zod";
import { QuoteResponse } from "../../../../../lib/miniapp/contract";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { parseInput, respond } from "../../../../../lib/miniapp/server/http";
import { quoteById } from "../../../../../lib/miniapp/server/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ id: z.string().uuid(), account: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** GET /api/miniapp/quote/:id?account=: one of the account's quotes (what a Telegram link opens). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return respond("quote by id", QuoteResponse, async () => {
    const q = parseInput(Query, { id, account: new URL(req.url).searchParams.get("account") ?? undefined });
    return quoteById(getDeps(), q.id, q.account as Address);
  });
}
