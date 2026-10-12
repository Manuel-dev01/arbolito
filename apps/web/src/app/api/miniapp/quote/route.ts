import { QuoteRequest, QuoteResponse } from "../../../../lib/miniapp/contract";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../lib/miniapp/server/http";
import { createQuote } from "../../../../lib/miniapp/server/quote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return respond("quote", QuoteResponse, async () => createQuote(getDeps(), await readJson(req, QuoteRequest)));
}
