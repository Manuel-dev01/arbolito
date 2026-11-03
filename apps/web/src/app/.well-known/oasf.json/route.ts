import { oasfRecord } from "../../../lib/oasf";

export const dynamic = "force-static";

/** OASF record (schema 0.8.0). */
export function GET() {
  return Response.json(oasfRecord(), { headers: { "access-control-allow-origin": "*" } });
}
