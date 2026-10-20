import type { Address } from "viem";
import { z } from "zod";
import { RulesListResponse } from "../../../../lib/miniapp/contract";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { parseInput, respond } from "../../../../lib/miniapp/server/http";
import { listRulesRes } from "../../../../lib/miniapp/server/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ account: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** GET /api/miniapp/rules?account=: the account's standing rules and their latest runs. */
export function GET(req: Request) {
  return respond("rules", RulesListResponse, async () => {
    const { account } = parseInput(Query, { account: new URL(req.url).searchParams.get("account") ?? undefined });
    return listRulesRes(getDeps(), account as Address);
  });
}
