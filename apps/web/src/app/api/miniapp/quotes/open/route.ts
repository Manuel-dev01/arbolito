import type { Address } from "viem";
import { z } from "zod";
import { OpenQuoteResponse } from "../../../../../lib/miniapp/contract";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { parseInput, respond } from "../../../../../lib/miniapp/server/http";
import { openQuote } from "../../../../../lib/miniapp/server/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ account: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

export function GET(req: Request) {
  return respond("open quote", OpenQuoteResponse, async () => {
    const { account } = parseInput(Query, { account: new URL(req.url).searchParams.get("account") ?? undefined });
    return openQuote(getDeps(), account as Address);
  });
}
