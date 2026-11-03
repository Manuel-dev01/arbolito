import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { NextRequest } from "next/server";
import { createMcpServer } from "../../../lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** MCP over streamable HTTP, stateless: one server and transport per request, JSON responses. */
async function handle(req: NextRequest): Promise<Response> {
  // Paid calls go to this deployment; links use the public address.
  const server = createMcpServer(req.nextUrl.origin, process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") || req.nextUrl.origin);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
