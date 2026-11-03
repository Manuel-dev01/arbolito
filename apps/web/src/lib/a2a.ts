import { isAddress, type Address } from "viem";
import { bundleHash } from "@arbolito/proof";
import { getReceiptCached, verifyReceipt } from "./cached";
import { loadDesk, loadFiatRates } from "./desk";
import { chatTurn } from "./miniapp/server/chat";
import { getDeps } from "./miniapp/server/deps";
import { ApiFailure } from "./miniapp/server/errors";

/**
 * Arbolito as an A2A agent (protocol 0.3.0, JSON-RPC `message/send` at /api/a2a). A data part
 * `{ skill, ... }` runs a skill directly; free text goes to Arbolito's chat agent, which needs the
 * caller's wallet in `metadata.account` (history and quotes are kept per wallet). Paid skills
 * answer with their x402 endpoint: the caller pays it directly, in local stablecoins or dollars.
 */

export const A2A_VERSION = "0.3.0";

export const SKILLS = [
  { id: "rates_summary", name: "LatAm dollar rates", description: "Local currency per US$ for ARS, BRL, COP and MXN, as Arbolito Desk prices them on Celo. Free.", tags: ["fx", "latam", "rates", "free"], examples: ['{"skill":"rates_summary"}'] },
  { id: "quote", name: "Best conversion route (x402)", description: "Best route across Textile RFQ and Uniswap v3 on Celo between wARS, wBRL, wCOP, wMXN, USDT, USDC and USA₮, vs official and Western Union. US$ 0.01 over x402, payable in local stablecoins or dollars.", tags: ["fx", "quote", "x402", "wfiat"], examples: ['{"skill":"quote","from":"USDT","to":"wARS","amount":"100"}'] },
  { id: "rates", name: "LatAm FX references (x402)", description: "Argentina's official, MEP, CCL and crypto dollars, BRL/COP/MXN references, Celo market mids, Western Union and the desk's fair values. US$ 0.005 over x402.", tags: ["fx", "oracle", "x402"], examples: ['{"skill":"rates"}'] },
  { id: "verify_receipt", name: "Verify a conversion receipt", description: "Checks an Arbolito receipt against Celo mainnet: anchored hash, execution and attribution tag. Free.", tags: ["proof", "receipt", "free"], examples: ['{"skill":"verify_receipt","id":"<uuid>"}'] },
  { id: "desk_state", name: "Arbolito Desk", description: "The Textile FX maker's corridors, served prices, fills and P&L. Free.", tags: ["textile", "market-making", "free"], examples: ['{"skill":"desk_state"}'] },
  { id: "chat", name: "Ask Arbolito", description: "Ask in Spanish, Portuguese or English about changing or sending dollars, pesos and reais on Celo. Pass your wallet as metadata.account.", tags: ["chat", "es", "pt", "en"], examples: ["¿Cuántos pesos me dan por 100 dólares?"] },
] as const;

export function agentCard(base: string) {
  return {
    protocolVersion: A2A_VERSION,
    name: "Arbolito",
    description:
      "An AI money-changer for Latin America on Celo. It quotes, converts and sends dollars, Argentine pesos, Brazilian reais, Colombian and Mexican pesos (USDT, wARS, wBRL, wCOP, wMXN) at the best mix of Textile RFQ and Uniswap v3, charges other agents over x402 in those same local stablecoins, and runs a Textile FX desk.",
    url: `${base}/api/a2a`,
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    provider: { organization: "Arbolito", url: base },
    iconUrl: `${base}/arbolito.png`,
    documentationUrl: "https://github.com/Manuel-dev01/arbolito",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: SKILLS,
    additionalInterfaces: [
      { url: `${base}/api/a2a`, transport: "JSONRPC" },
      { url: `${base}/api/mcp`, transport: "MCP" },
    ],
  };
}

type Part = { kind: "text"; text: string } | { kind: "data"; data: Record<string, unknown> };
interface IncomingMessage {
  role?: string;
  parts?: Part[];
  messageId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

const reply = (m: IncomingMessage, parts: Part[]) => ({
  kind: "message",
  role: "agent",
  messageId: crypto.randomUUID(),
  ...(m.contextId ? { contextId: m.contextId } : {}),
  parts,
});

async function runSkill(base: string, d: Record<string, unknown>): Promise<Part[]> {
  switch (d.skill) {
    case "rates_summary":
      return [{ kind: "data", data: { localPerUsd: await loadFiatRates(), at: new Date().toISOString() } }];
    case "desk_state": {
      const desk = await loadDesk();
      return [{ kind: "data", data: { corridors: desk.feed?.corridors.map((c) => ({ pair: c.pair, served: c.served })) ?? null, fills: desk.stats.fills, volumeUsdMicros: desk.stats.volumeMicros } }];
    }
    case "verify_receipt": {
      const id = String(d.id ?? "");
      const rec = await getReceiptCached(id).catch(() => null);
      if (!rec) return [{ kind: "text", text: "Receipt not found." }];
      const hash = bundleHash(rec.bundle);
      const v = await verifyReceipt(hash, rec.bundle);
      return [{ kind: "data", data: { id, bundleHash: hash, verified: v.result?.ok ?? false, verification: v.result ?? null, error: v.error ?? null } }];
    }
    case "quote": {
      const q = new URLSearchParams({ from: String(d.from ?? ""), to: String(d.to ?? ""), amount: String(d.amount ?? "") });
      return [
        { kind: "text", text: "This skill is paid over x402 (US$ 0.01, in wARS, wBRL, wCOP, wMXN, USDT, USDC or USA₮). GET the endpoint without payment for the requirements, then pay with an x402 v2 client." },
        { kind: "data", data: { x402: `${base}/api/x402/quote?${q}` } },
      ];
    }
    case "rates":
      return [
        { kind: "text", text: "This skill is paid over x402 (US$ 0.005, in local stablecoins or dollars)." },
        { kind: "data", data: { x402: `${base}/api/x402/rates` } },
      ];
    default:
      return [{ kind: "data", data: { error: "unknown skill", skills: SKILLS.map((s) => s.id) } }];
  }
}

/** Handles one JSON-RPC request; returns the JSON-RPC response object. */
export async function handleA2A(base: string, body: unknown, ip: string): Promise<Record<string, unknown>> {
  const rpc = (body ?? {}) as { jsonrpc?: string; id?: unknown; method?: string; params?: { message?: IncomingMessage } };
  const id = rpc.id ?? null;
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return error(-32600, "Invalid JSON-RPC request");
  if (rpc.method !== "message/send") return error(-32601, `Method not found: ${rpc.method} (this agent supports message/send)`);
  const m = rpc.params?.message;
  if (!m?.parts?.length) return error(-32602, "params.message.parts is required");

  const data = m.parts.find((p): p is Extract<Part, { kind: "data" }> => p.kind === "data")?.data;
  if (data?.skill) return { jsonrpc: "2.0", id, result: reply(m, await runSkill(base, data)) };

  const text = m.parts.filter((p): p is Extract<Part, { kind: "text" }> => p.kind === "text").map((p) => p.text).join("\n").trim();
  const account = m.metadata?.account;
  if (!text) return error(-32602, "Send a text part, or a data part with a skill");
  if (typeof account !== "string" || !isAddress(account)) {
    return {
      jsonrpc: "2.0",
      id,
      result: reply(m, [
        { kind: "text", text: "To chat, pass your wallet address as metadata.account (Arbolito keeps history and quotes per wallet). Or call a skill with a data part." },
        { kind: "data", data: { skills: SKILLS.map((s) => ({ id: s.id, example: s.examples[0] })) } },
      ]),
    };
  }
  try {
    const res = await chatTurn(getDeps(), { account: account as Address, lang: "en", text }, ip);
    return { jsonrpc: "2.0", id, result: reply(m, [{ kind: "text", text: res.reply }, ...(res.quotes.length ? [{ kind: "data" as const, data: { quotes: res.quotes } }] : [])]) };
  } catch (e) {
    return error(-32603, e instanceof ApiFailure ? e.message : "The assistant is not answering right now.");
  }
}
