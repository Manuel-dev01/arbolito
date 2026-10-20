import type { Address } from "viem";
import { z } from "zod";
import { LinkStatusResponse } from "../../../../../lib/miniapp/contract";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { parseInput, respond } from "../../../../../lib/miniapp/server/http";
import { linkStatus } from "../../../../../lib/miniapp/server/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ account: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** GET /api/miniapp/link/status?account=: is this wallet connected to Telegram. */
export function GET(req: Request) {
  return respond("link status", LinkStatusResponse, async () => {
    const { account } = parseInput(Query, { account: new URL(req.url).searchParams.get("account") ?? undefined });
    return linkStatus(getDeps(), account as Address);
  });
}
