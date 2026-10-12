import { CallsResponse, RevokePlanRequest } from "../../../../../lib/miniapp/contract";
import { autonomyRevokePlan } from "../../../../../lib/miniapp/server/autonomy";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../../lib/miniapp/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return respond("autonomy revoke", CallsResponse, async () => autonomyRevokePlan(getDeps(), await readJson(req, RevokePlanRequest)));
}
