import { PayrollCreateRequest, RuleResponse } from "../../../../lib/miniapp/contract";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { rateLimited } from "../../../../lib/miniapp/server/errors";
import { clientIp, readJson, respond } from "../../../../lib/miniapp/server/http";
import { createPayroll } from "../../../../lib/miniapp/server/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/miniapp/payroll: a payroll schedule, stored with the account's signature over its text. */
export function POST(req: Request) {
  return respond("payroll", RuleResponse, async () => {
    const deps = getDeps();
    if (!deps.limiter.take(`payroll:${clientIp(req)}`, 10, 10 * 60_000)) throw rateLimited("Too many attempts. Wait a few minutes.");
    return createPayroll(deps, await readJson(req, PayrollCreateRequest));
  });
}
