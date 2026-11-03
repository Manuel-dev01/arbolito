import type { z } from "zod";
import { encodeGiveFeedback, REPUTATION_REGISTRY, withAttribution } from "@arbolito/chain";
import type { CallsResponse, RatePrepareRequest } from "../contract";
import type { MiniappDeps } from "./deps";
import { badRequest, notFound, notReady } from "./errors";
import { symOf } from "./quote";

/** Arbolito's ERC-8004 agentId on Celo. */
export const ARBOLITO_AGENT_ID = 9976n;

/**
 * POST /rate/prepare: a tagged ERC-8004 giveFeedback call rating Arbolito 20–100 (1–5 stars).
 * Only the wallet that made the conversion can rate it, and the receipt page is the evidence
 * (its URL is the feedbackURI, hashed into feedbackHash). The user signs it in MiniPay.
 */
export async function ratePrepare(deps: MiniappDeps, req: z.infer<typeof RatePrepareRequest>): Promise<z.infer<typeof CallsResponse>> {
  if (!deps.attributionCode) throw notReady("ATTRIBUTION_CODE is not configured; every transaction must carry it.");
  const row = await deps.store().getReceipt(req.receiptId.toLowerCase());
  if (!row) throw notFound("Receipt not found.");
  if (row.taker.toLowerCase() !== req.account.toLowerCase()) throw badRequest("Only the wallet that made this conversion can rate it.", 403);
  // Onchain evidence must be an absolute link, even when PUBLIC_BASE_URL is unset (relative app links).
  const base = deps.baseUrl || "https://arbolito-livid.vercel.app";
  const data = encodeGiveFeedback({
    agentId: ARBOLITO_AGENT_ID,
    score: req.stars * 20,
    tag1: "conversion",
    tag2: `${symOf(row.tokenIn)}-${symOf(row.tokenOut)}`,
    endpoint: `${base}/app`,
    feedbackURI: `${base}/r/${row.id}`,
  });
  return { calls: [{ to: REPUTATION_REGISTRY, data: withAttribution(data, deps.attributionCode), value: "0", label: "Rate Arbolito" }] };
}
