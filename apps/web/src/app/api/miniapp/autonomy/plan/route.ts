import { AutonomyPlanRequest, CallsResponse } from "../../../../../lib/miniapp/contract";
import { autonomyPlan } from "../../../../../lib/miniapp/server/autonomy";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../../lib/miniapp/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return respond("autonomy plan", CallsResponse, async () => autonomyPlan(getDeps(), await readJson(req, AutonomyPlanRequest)));
}
