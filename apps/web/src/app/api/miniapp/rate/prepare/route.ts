import { CallsResponse, RatePrepareRequest } from "../../../../../lib/miniapp/contract";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../../lib/miniapp/server/http";
import { ratePrepare } from "../../../../../lib/miniapp/server/rate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return respond("rate prepare", CallsResponse, async () => ratePrepare(getDeps(), await readJson(req, RatePrepareRequest)));
}
