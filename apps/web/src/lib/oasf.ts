/** Arbolito's OASF record (schema 0.8.0), served at /.well-known/oasf.json and listed in the ERC-8004 file. */
export const OASF_SKILLS = [
  "tool_interaction/api_schema_understanding",
  "tool_interaction/workflow_automation",
  "analytical_skills/mathematical_reasoning/math_word_problems",
  "natural_language_processing/language_translation/translation",
  "natural_language_processing/information_retrieval_synthesis/question_answering",
] as const;

export const OASF_DOMAINS = ["finance_and_business/finance", "finance_and_business/banking", "technology/blockchain", "technology/blockchain/decentralized_finance", "trust_and_safety/risk_management"] as const;

export function oasfRecord() {
  return {
    schema_version: "0.8.0",
    name: "Arbolito",
    description:
      "AI money-changer for Latin America on Celo: quotes, converts and sends USDT, wARS, wBRL, wCOP and wMXN at the best mix of Textile RFQ and Uniswap v3, anchors a verifiable receipt for every conversion, acts within limits users sign (ArbolitoGuard), charges other agents over x402 in local stablecoins, and runs a Textile FX desk.",
    version: "1.0.0",
    skills: [
      { id: 501, name: "Mathematical Reasoning", category: "Analytical Skills" },
      { id: 1401, name: "API Schema Understanding", category: "Tool Interaction" },
      { id: 1402, name: "Workflow Automation", category: "Tool Interaction" },
    ],
    domains: [
      { id: 202, name: "Finance", category: "Finance and Business" },
      { id: 109, name: "Blockchain", category: "Technology" },
      { id: 10902, name: "Decentralized Finance (DeFi)", category: "Technology" },
      { id: 405, name: "Risk Management", category: "Trust and Safety" },
    ],
    capabilities: ["autonomous_execution", "on_chain_verification", "best_execution_routing", "x402_payments", "bounded_delegation", "market_making"],
    status: "active",
  };
}
