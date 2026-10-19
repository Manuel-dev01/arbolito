import { loadEnv } from "@arbolito/config";
import { agentRegistration } from "../../../lib/agent-registration";

export const dynamic = "force-dynamic";

/** GET /.well-known/agent-registration.json: Arbolito's ERC-8004 registration file (the agent URI). */
export function GET() {
  const env = loadEnv();
  const base = env.PUBLIC_BASE_URL ?? "https://arbolito-livid.vercel.app";
  return Response.json(agentRegistration(base, env.ERC8004_AGENT_ID), {
    headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
}
