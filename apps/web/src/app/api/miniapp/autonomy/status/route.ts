import type { Address } from "viem";
import { z } from "zod";
import { AutonomyStatus } from "../../../../../lib/miniapp/contract";
import { autonomyStatus } from "../../../../../lib/miniapp/server/autonomy";
import { getDeps } from "../../../../../lib/miniapp/server/deps";
import { parseInput, respond } from "../../../../../lib/miniapp/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
/** candidates: the phone's contact wallets, comma-separated (the guard is asked about each). */
const Query = z.object({ account: Addr, candidates: z.array(Addr).max(50).default([]) });

export function GET(req: Request) {
  return respond("autonomy status", AutonomyStatus, async () => {
    const p = new URL(req.url).searchParams;
    const { account, candidates } = parseInput(Query, { account: p.get("account") ?? undefined, candidates: p.get("candidates")?.split(",").filter(Boolean) ?? [] });
    return autonomyStatus(getDeps(), account as Address, candidates as Address[]);
  });
}
