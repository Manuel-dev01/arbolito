import { LinkConfirmRequest, LinkConfirmResponse } from "../../../../../lib/miniapp/contract";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { clientIp, readJson, respond } from "../../../../../lib/miniapp/server/http";
import { confirmLink } from "../../../../../lib/miniapp/server/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return respond("link confirm", LinkConfirmResponse, async () => confirmLink(getDeps(), await readJson(req, LinkConfirmRequest), clientIp(req)));
}
