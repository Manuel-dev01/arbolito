import { RuleCancelRequest, RuleResponse } from "../../../../../lib/miniapp/contract";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../../lib/miniapp/server/http";
import { cancelRuleReq } from "../../../../../lib/miniapp/server/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/miniapp/rules/cancel: cancels a rule with the account's signature. */
export function POST(req: Request) {
  return respond("rules cancel", RuleResponse, async () => cancelRuleReq(getDeps(), await readJson(req, RuleCancelRequest)));
}
