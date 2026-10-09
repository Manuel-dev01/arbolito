import { getReceiptCached } from "../../../../lib/cached";

/** The raw ProofBundle JSON, for anyone who wants to recompute the hash outside the page. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await getReceiptCached(id);
  if (!rec) return Response.json({ error: "not_found" }, { status: 404 });
  return new Response(`${JSON.stringify(rec.bundle, null, 2)}\n`, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `inline; filename="${rec.id}.json"`,
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=60, s-maxage=300",
    },
  });
}
