import type { Address } from "viem";
import { z } from "zod";
import { AutonomyStatus } from "../../../../../lib/miniapp/contract";
import { autonomyStatus } from "../../../../../lib/miniapp/server/autonomy";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { parseInput, respond } from "../../../../../lib/miniapp/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ account: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

export function GET(req: Request) {
  return respond("autonomy status", AutonomyStatus, async () => {
    const { account } = parseInput(Query, { account: new URL(req.url).searchParams.get("account") ?? undefined });
    return autonomyStatus(getDeps(), account as Address);
  });
}
