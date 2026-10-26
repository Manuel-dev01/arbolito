import { PauseRequest, PauseResponse } from "../../../../../lib/miniapp/contract";
import { autonomyPause } from "../../../../../lib/miniapp/server/autonomy";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { readJson, respond } from "../../../../../lib/miniapp/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/miniapp/autonomy/pause: pause or resume Arbolito with the account's signature (no transaction). */
export function POST(req: Request) {
  return respond("autonomy pause", PauseResponse, async () => autonomyPause(getDeps(), await readJson(req, PauseRequest)));
}
