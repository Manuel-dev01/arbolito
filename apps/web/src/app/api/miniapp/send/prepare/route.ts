import { SendPrepareRequest, SendPrepareResponse } from "../../../../../lib/miniapp/contract";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../../lib/miniapp/server/http";
import { prepareSend } from "../../../../../lib/miniapp/server/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cross-currency send may take a Textile firm quote, which can block for up to ~70 s.
export const maxDuration = 90;

export function POST(req: Request) {
  return respond("send/prepare", SendPrepareResponse, async () => prepareSend(getDeps(), await readJson(req, SendPrepareRequest)));
}
