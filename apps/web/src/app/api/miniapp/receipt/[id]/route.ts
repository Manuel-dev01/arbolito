import { ReceiptResponse } from "../../../../../lib/miniapp/contract";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { respond } from "../../../../../lib/miniapp/server/http";
import { getMiniappReceipt } from "../../../../../lib/miniapp/server/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return respond("receipt", ReceiptResponse, async () => getMiniappReceipt(getDeps(), (await ctx.params).id));
}
