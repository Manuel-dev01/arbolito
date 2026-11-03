import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bundleHash } from "@arbolito/proof";
import { SYMBOLS } from "./miniapp/contract";
import { getReceiptCached, verifyReceipt } from "./cached";
import { loadDesk, loadFiatRates } from "./desk";

/**
 * Arbolito's MCP server (streamable HTTP at /api/mcp). Free tools read what Arbolito already
 * publishes; paid tools speak x402 over MCP: called without `payment` they return the payment
 * requirements, called with a v2 `PAYMENT-SIGNATURE` value they forward it to the paid HTTP
 * endpoint, where Celo's facilitator settles it, and return the result with the settlement.
 */

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 1) }] });

function decodeHeader(v: string | null): unknown {
  if (!v) return null;
  try {
    return JSON.parse(Buffer.from(v, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Calls a paid endpoint, unpaid (for its requirements) or with the caller's payment. */
async function forwardPaid(url: string, payment?: string) {
  const res = await fetch(url, { headers: payment ? { "PAYMENT-SIGNATURE": payment } : {}, signal: AbortSignal.timeout(60_000) });
  const body = await res.json().catch(() => null);
  if (res.status === 402) {
    return {
      ...json({
        paymentRequired: decodeHeader(res.headers.get("payment-required")),
        ...(payment ? { refused: body } : {}),
        howToPay: `Sign one of the accepted options with an x402 v2 client (exact scheme, Celo mainnet) and call this tool again with "payment" set to the PAYMENT-SIGNATURE header value. Or GET ${url} directly with that header.`,
      }),
      isError: Boolean(payment),
    };
  }
  if (!res.ok) return { ...json({ status: res.status, error: body }), isError: true };
  return json({ result: body, settlement: decodeHeader(res.headers.get("payment-response")) });
}

const Symbol = z.enum(SYMBOLS);

export function createMcpServer(origin: string, publicUrl = origin): McpServer {
  const server = new McpServer({ name: "arbolito", version: "1.0.0" });

  server.registerTool(
    "get_rates_summary",
    {
      title: "LatAm dollar rates (free)",
      description: "Local currency per US dollar for ARS, BRL, COP and MXN, as Arbolito Desk prices them on Celo right now (its fair value from several sources). Free.",
      inputSchema: {},
    },
    async () => json({ at: new Date().toISOString(), localPerUsd: await loadFiatRates(), source: "Arbolito Desk fair value (https://arbolito-livid.vercel.app/desk)" }),
  );

  server.registerTool(
    "desk_state",
    {
      title: "Arbolito Desk (free)",
      description: "Arbolito Desk, a Textile FX maker on Celo: corridors it quotes against USDT, the price it serves, fills and P&L summary. Free.",
      inputSchema: {},
    },
    async () => {
      const d = await loadDesk();
      return json({
        corridors: d.feed?.corridors.map((c) => ({ pair: c.pair, live: c.params.live ?? true, served: c.served, lastDecision: c.decisions.at(-1)?.action ?? null })) ?? null,
        fills: d.stats.fills,
        volumeUsdMicros: d.stats.volumeMicros,
        spreadUsdMicros: d.stats.spreadMicros,
        rfqsWon: d.rfqsWon,
      });
    },
  );

  server.registerTool(
    "verify_receipt",
    {
      title: "Verify a conversion receipt (free)",
      description: "Checks an Arbolito receipt against Celo mainnet: the ProofBundle hash is anchored on ArbolitoReceipts, and the execution transaction delivered exactly what the receipt says, with Arbolito's attribution tag. Free.",
      inputSchema: { id: z.string().uuid().describe("Receipt id, as in https://arbolito-livid.vercel.app/r/<id>") },
    },
    async ({ id }) => {
      const rec = await getReceiptCached(id);
      if (!rec) return { ...json({ error: "receipt not found" }), isError: true };
      const hash = bundleHash(rec.bundle);
      const v = await verifyReceipt(hash, rec.bundle);
      return json({ id, bundleHash: hash, url: `${publicUrl}/r/${id}`, verified: v.result?.ok ?? false, verification: v.result ?? null, error: v.error ?? null });
    },
  );

  server.registerTool(
    "get_quote",
    {
      title: "Best conversion route (paid, x402)",
      description:
        "Arbolito's best route across Textile RFQ and Uniswap v3 on Celo for converting between wARS, wBRL, wCOP, wMXN, USDT, USDC and USA₮, with alternatives and how it compares with the official rate and Western Union. Costs US$ 0.01, payable in wARS, wBRL, wCOP, wMXN, USDT, USDC or USA₮ over x402. Call without `payment` to get the requirements.",
      inputSchema: {
        from: Symbol,
        to: Symbol,
        amount: z.string().regex(/^\d+(\.\d+)?$/).describe("Amount of `from`, in human units (e.g. 100)"),
        payment: z.string().optional().describe("x402 v2 PAYMENT-SIGNATURE header value"),
      },
    },
    async ({ from, to, amount, payment }) => forwardPaid(`${origin}/api/x402/quote?${new URLSearchParams({ from, to, amount })}`, payment),
  );

  server.registerTool(
    "get_rates",
    {
      title: "LatAm FX references (paid, x402)",
      description:
        "Every reference Arbolito prices with: Argentina's official, MEP, CCL and crypto dollars; BRL, COP and MXN references; Textile and Uniswap mids on Celo; Western Union's rate read through buy; and Arbolito Desk's fair values. Costs US$ 0.005 over x402 (local stablecoins or dollars). Call without `payment` to get the requirements.",
      inputSchema: { payment: z.string().optional().describe("x402 v2 PAYMENT-SIGNATURE header value") },
    },
    async ({ payment }) => forwardPaid(`${origin}/api/x402/rates`, payment),
  );

  return server;
}
