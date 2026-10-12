import { SubmitRequest, SubmitResponse } from "../../../../lib/miniapp/contract";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../lib/miniapp/server/http";
import { submitQuote } from "../../../../lib/miniapp/server/submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Anchoring (when enabled) waits for its receipt.
export const maxDuration = 60;

export function POST(req: Request) {
  return respond("submit", SubmitResponse, async () => submitQuote(getDeps(), await readJson(req, SubmitRequest)));
}
