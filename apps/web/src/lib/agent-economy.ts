/**
 * What Arbolito, the agent, charges, pays and settles, for /agent. Every row carries its Celo
 * transaction. Server only; each source fails soft (an empty list), never the page.
 */
import { unstable_cache } from "next/cache";
import { recentAgentPurchases, recentRuleRunsWithTx, recentX402Sales } from "@arbolito/db";
import { loadBuyPurchases } from "./buy-public";
import { listReceiptsCached } from "./cached";
import { webDb } from "./data";
import { loadDeskData } from "./desk";
import { computeMetrics } from "./metrics";

export interface Sale {
  at: string;
  resource: string;
  payer: string;
  asset: string;
  amount: string;
  usdMicros: string;
  txHash: string;
}

export interface Payment {
  at: string;
  /** buy (Western Union reads) or another agent. */
  provider: string;
  providerAgentId: number | null;
  what: string;
  usdMicros: string;
  txHash: string | null;
  feedbackTx: string | null;
}

export interface Settlement {
  at: string;
  kind: "rule" | "guardian" | "split";
  account: string;
  status: string;
  txHashes: string[];
}

export interface Reputation {
  score: number | null;
  rank: number | null;
  feedbacks: number | null;
}

export interface AgentEconomy {
  sales: Sale[];
  salesUsdMicros: bigint;
  payments: Payment[];
  paidUsdMicros: bigint;
  ruleRuns: Settlement[];
  conversions: { count: number; usdMicros: bigint; wallets: number };
  desk: { fills: number; volumeMicros: bigint; spreadMicros: bigint };
  reputation: Reputation;
}

const loadDbParts = unstable_cache(
  async () => {
    const db = webDb();
    if (!db) return { sales: [], purchases: [], runs: [] };
    const [sales, purchases, runs] = await Promise.all([recentX402Sales(db, 100).catch(() => []), recentAgentPurchases(db, 100).catch(() => []), recentRuleRunsWithTx(db, 50).catch(() => [])]);
    return {
      sales: sales.map((s) => ({ at: s.at.toISOString(), resource: s.resource, payer: s.payer, asset: s.asset, amount: s.amount, usdMicros: s.usdMicros, txHash: s.txHash })),
      purchases: purchases.map((p) => ({ at: p.at.toISOString(), provider: p.provider, providerAgentId: p.providerAgentId, what: p.usedFor, usdMicros: p.usdMicros, txHash: p.paymentTx, feedbackTx: p.feedbackTx, status: p.status })),
      runs: runs.map((r) => ({ at: r.createdAt.toISOString(), kind: r.kind, account: r.account, status: r.status, txHashes: (r.txHashes as string[]) ?? [] })),
    };
  },
  ["agent-economy-db-v1"],
  { revalidate: 60 },
);

/** Arbolito's ERC-8004 profile as 8004scan scores it (agent 9976 on Celo). */
const loadReputation = unstable_cache(
  async (): Promise<Reputation> => {
    try {
      const res = await fetch("https://8004scan.io/api/v1/agents/42220/9976", { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return { score: null, rank: null, feedbacks: null };
      const a = (await res.json()) as { total_score?: number; rank?: number; total_feedbacks?: number };
      return { score: a.total_score ?? null, rank: a.rank ?? null, feedbacks: a.total_feedbacks ?? null };
    } catch {
      return { score: null, rank: null, feedbacks: null };
    }
  },
  ["agent-reputation-v1"],
  { revalidate: 600 },
);

export async function loadAgentEconomy(): Promise<AgentEconomy> {
  const [dbParts, buys, receipts, desk, reputation] = await Promise.all([
    loadDbParts().catch(() => ({ sales: [], purchases: [], runs: [] })),
    loadBuyPurchases().catch(() => []),
    listReceiptsCached().catch(() => ({ records: [], fetchedAt: "" })),
    loadDeskData(),
    loadReputation(),
  ]);

  // One buy payment paid for one browser session (two readings share it): count each tx once.
  const seen = new Set<string>();
  const buyPayments: Payment[] = [];
  for (const b of buys) {
    if (!b.paymentTx || seen.has(b.paymentTx)) continue;
    seen.add(b.paymentTx);
    buyPayments.push({ at: b.at, provider: "buy (usebuy.ai)", providerAgentId: null, what: "Western Union rate, read in a rented browser", usdMicros: b.paidAtomic ?? "0", txHash: b.paymentTx, feedbackTx: null });
  }
  const agentPayments: Payment[] = dbParts.purchases.filter((p) => p.status === "sent").map(({ status: _s, ...p }) => p);
  const payments = [...agentPayments, ...buyPayments].sort((a, b) => b.at.localeCompare(a.at));

  const m = computeMetrics(receipts.records);
  return {
    sales: dbParts.sales,
    salesUsdMicros: dbParts.sales.reduce((s, x) => s + BigInt(x.usdMicros), 0n),
    payments,
    paidUsdMicros: payments.reduce((s, x) => s + BigInt(x.usdMicros), 0n),
    ruleRuns: dbParts.runs.map((r) => ({ ...r, kind: r.kind === "guardian" ? "guardian" : r.kind === "split" ? "split" : "rule" })),
    conversions: { count: m.receipts.length, usdMicros: m.totalUsdMicros, wallets: m.wallets.length },
    desk: { fills: desk.stats.fills, volumeMicros: BigInt(desk.stats.volumeMicros), spreadMicros: BigInt(desk.stats.spreadMicros) },
    reputation,
  };
}
