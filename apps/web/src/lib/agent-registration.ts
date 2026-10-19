import { CONTRACTS } from "@arbolito/config";

/** The ops wallet that owns Arbolito's ERC-8004 identity and its contracts (docs/04-reference.md). */
export const AGENT_WALLET = "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c";
/** The desk's public state (Textile maker; docs/10-desk-plan.md). */
export const DESK_STATE_URL = "https://desk-feed-production.up.railway.app/state";

/**
 * ERC-8004 registration file (registration-v1), served at /.well-known/agent-registration.json and
 * registered onchain as the agent URI. It lists only services that are live: the x402 FX API and
 * the MCP server join it when they ship (the URI stays the same, so no new transaction).
 */
export function agentRegistration(baseUrl: string, agentId: string | undefined) {
  const base = baseUrl.replace(/\/$/, "");
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Arbolito",
    description:
      "Arbolito is an autonomous cambista (money-changer) agent on Celo for Latin America. Inside MiniPay and on Telegram (es/pt/en, voice notes) it quotes, converts and sends USDT, wARS and wBRL at the best mix of Textile RFQ and Uniswap v3, and anchors a verifiable receipt onchain for every conversion. With the user's permission (ArbolitoGuard, capped per transaction and per day) it can act for them. Arbolito Desk is its Textile FX maker, quoting wARS, wBRL, wCOP, wMXN, USDC and USA₮ against USDT.",
    image: `${base}/arbolito.png`,
    services: [
      { name: "web", endpoint: `${base}/` },
      { name: "minipay-mini-app", endpoint: `${base}/app` },
      { name: "telegram", endpoint: "https://t.me/arbolitoo_bot" },
      { name: "receipts", endpoint: `${base}/r/` },
      { name: "metrics", endpoint: `${base}/metrics` },
      { name: "textile-fx-desk", endpoint: `${base}/desk` },
      { name: "desk-state", endpoint: DESK_STATE_URL },
      { name: "agentWallet", endpoint: `eip155:42220:${AGENT_WALLET}` },
    ],
    x402Support: false,
    active: true,
    registrations: agentId ? [{ agentId: Number(agentId), agentRegistry: `eip155:42220:${CONTRACTS.erc8004.identity}` }] : [],
    supportedTrust: ["reputation"],
  };
}
