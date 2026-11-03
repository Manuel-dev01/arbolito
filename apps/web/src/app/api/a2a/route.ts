import type { NextRequest } from "next/server";
import { agentCard, handleA2A } from "../../../lib/a2a";
import { clientIp } from "../../../lib/miniapp/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const base = (req: NextRequest) => process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || req.nextUrl.origin;

/** A2A JSON-RPC (message/send). */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  return Response.json(await handleA2A(base(req), body, clientIp(req)));
}

/** GET returns the agent card, for clients that look here first. */
export function GET(req: NextRequest) {
  return Response.json(agentCard(base(req)));
}
