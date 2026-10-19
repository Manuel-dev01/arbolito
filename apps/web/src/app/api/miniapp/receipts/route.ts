import type { Address } from "viem";
import { z } from "zod";
import { ReceiptsListResponse } from "../../../../lib/miniapp/contract";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { parseInput, respond } from "../../../../lib/miniapp/server/http";
import { listReceipts } from "../../../../lib/miniapp/server/receipts-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Query = z.object({ account: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

export function GET(req: Request) {
  return respond("receipts", ReceiptsListResponse, async () => {
    const { account } = parseInput(Query, { account: new URL(req.url).searchParams.get("account") ?? undefined });
    return listReceipts(getDeps(), account as Address);
  });
}
