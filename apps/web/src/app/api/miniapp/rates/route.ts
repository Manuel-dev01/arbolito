import { RatesResponse } from "../../../../lib/miniapp/contract";
import { getDeps } from "../../../../lib/miniapp/server/deps";
import { respond } from "../../../../lib/miniapp/server/http";
import { getRates } from "../../../../lib/miniapp/server/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return respond("rates", RatesResponse, () => getRates(getDeps()));
}
