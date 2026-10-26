import { SubmitRequest, SubmitResponse } from "../../../../lib/miniapp/contract";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../lib/miniapp/server/http";
import { submitQuote } from "../../../../lib/miniapp/server/submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Anchoring (when enabled) waits for its receipt.
// The anchor can wait up to 120 s for its receipt (sendGuarded); stop well after that.
export const maxDuration = 180;

export function POST(req: Request) {
  return respond("submit", SubmitResponse, async () => submitQuote(getDeps(), await readJson(req, SubmitRequest)));
}
