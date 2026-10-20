import { RuleConfirmRequest, RuleResponse } from "../../../../../lib/miniapp/contract";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../../lib/miniapp/server/http";
import { confirmRule } from "../../../../../lib/miniapp/server/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/miniapp/rules/confirm: turns a drafted rule on with the account's signature over its text. */
export function POST(req: Request) {
  return respond("rules confirm", RuleResponse, async () => confirmRule(getDeps(), await readJson(req, RuleConfirmRequest)));
}
