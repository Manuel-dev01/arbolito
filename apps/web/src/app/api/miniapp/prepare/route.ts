import { PrepareRequest, PrepareResponse } from "../../../../lib/miniapp/contract";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../lib/miniapp/server/http";
import { prepareQuote } from "../../../../lib/miniapp/server/prepare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A Textile firm request can block for up to ~70 s.
export const maxDuration = 90;

export function POST(req: Request) {
  return respond("prepare", PrepareResponse, async () => prepareQuote(getDeps(), await readJson(req, PrepareRequest)));
}
