import { getDeps } from "../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../lib/miniapp/server/http";
import { RejectRequest, RejectResponse, rejectQuote } from "../../../../lib/miniapp/server/reject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return respond("reject", RejectResponse, async () => rejectQuote(getDeps(), await readJson(req, RejectRequest)));
}
