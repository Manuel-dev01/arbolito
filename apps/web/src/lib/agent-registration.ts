import { CONTRACTS } from "@arbolito/config";
import { SKILLS, A2A_VERSION } from "./a2a";
import { OASF_DOMAINS, OASF_SKILLS } from "./oasf";

/** The ops wallet that owns Arbolito's ERC-8004 identity and its contracts (docs/04-reference.md). */
export const AGENT_WALLET = "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c";
/** The desk's public state (Textile maker; docs/DESK-STRATEGY.md). */
export const DESK_STATE_URL = "https://desk-feed-production.up.railway.app/state";

export const MCP_TOOLS = ["get_rates_summary", "desk_state", "verify_receipt", "get_quote", "get_rates"] as const;

/**
 * ERC-8004 registration file (registration-v1), served at /.well-known/agent-registration.json and
 * registered onchain as the agent URI. It lists only services that are live. The URI never
 * changes, so adding a service needs no transaction (indexers re-read the file).
 */
export function agentRegistration(baseUrl: string, agentId: string | undefined) {
  const base = baseUrl.replace(/\/$/, "");
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Arbolito",
    description:
      "Arbolito is an autonomous cambista (money-changer) agent on Celo for Latin America that charges, pays and settles in local stablecoins. Inside MiniPay and on Telegram (es/pt/en, voice notes) it quotes, converts and sends USDT, wARS, wBRL, wCOP and wMXN at the best mix of Textile RFQ and Uniswap v3, and anchors a verifiable receipt onchain for every conversion. With the user's signed permission (ArbolitoGuard, capped per operation and per day) it acts on its own: payday splits and monthly sends. Other agents hire it over MCP, A2A and x402, paying in wARS, wBRL, wCOP, wMXN or dollars through Celo's facilitator. Arbolito Desk is its Textile FX maker, quoting wARS, wBRL, wCOP, wMXN, USDC and USA₮ against USDT.",
    image: `${base}/arbolito.png`,
    services: [
      { name: "web", endpoint: `${base}/` },
      { name: "MCP", endpoint: `${base}/api/mcp`, version: "2025-06-18", mcpTools: [...MCP_TOOLS] },
      { name: "A2A", endpoint: `${base}/.well-known/agent-card.json`, version: A2A_VERSION, skills: SKILLS.map((s) => s.id) },
      { name: "OASF", endpoint: `${base}/.well-known/oasf.json`, version: "0.8.0", skills: [...OASF_SKILLS], domains: [...OASF_DOMAINS] },
      { name: "x402", endpoint: `${base}/api/x402/quote`, version: "2" },
      { name: "x402-rates", endpoint: `${base}/api/x402/rates`, version: "2" },
      { name: "minipay-mini-app", endpoint: `${base}/app` },
      { name: "telegram", endpoint: "https://t.me/arbolitoo_bot" },
      { name: "receipts", endpoint: `${base}/r/` },
      { name: "metrics", endpoint: `${base}/metrics` },
      { name: "textile-fx-desk", endpoint: `${base}/desk` },
      { name: "desk-state", endpoint: DESK_STATE_URL },
      { name: "agentWallet", endpoint: `eip155:42220:${AGENT_WALLET}` },
    ],
    x402Support: true,
    active: true,
    registrations: agentId ? [{ agentId: Number(agentId), agentRegistry: `eip155:42220:${CONTRACTS.erc8004.identity}` }] : [],
    supportedTrust: ["reputation"],
  };
}
