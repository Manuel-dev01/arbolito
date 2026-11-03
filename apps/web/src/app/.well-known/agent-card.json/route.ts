import type { NextRequest } from "next/server";
import { agentCard } from "../../../lib/a2a";

export const dynamic = "force-dynamic";

/** A2A agent card (protocol 0.3.0). */
export function GET(req: NextRequest) {
  return Response.json(agentCard(process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || req.nextUrl.origin), { headers: { "access-control-allow-origin": "*" } });
}
