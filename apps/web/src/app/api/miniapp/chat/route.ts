import { ChatRequest, ChatResponse } from "../../../../lib/miniapp/contract";
import { chatTurn } from "../../../../lib/miniapp/server/chat";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { clientIp, readJson, respond } from "../../../../lib/miniapp/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(req: Request) {
  return respond("chat", ChatResponse, async () => chatTurn(getDeps(), await readJson(req, ChatRequest), clientIp(req)));
}
