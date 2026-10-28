/**
 * The buy purchases behind "vs Western Union", for /metrics: each Western Union reading with the
 * x402 payment (Celo tx) that paid for the browser that read it. Server only.
 */
import { unstable_cache } from "next/cache";
import { recentCompetitorRates } from "@arbolito/db";
import { webDb } from "./data";

export interface BuyPurchase {
  at: string;
  corridor: string;
  rate: string;
  sourceUrl: string;
  paymentTx: string | null;
  paidAtomic: string | null;
}

/** Pays buy since 2026-10-28: the agent wallet (ops, ERC-8004 agent 9976), the one on the hackathon entry. */
export const BUY_PAYER = "0x7e0316b2533F6dF2E651295A9B11481BB8346c3c";
/** Paid buy before that (2026-10-21 → 2026-10-28); its readings stay in the list. */
export const BUY_PAYER_BEFORE = "0xD07b5BD9C86eFB042af3343a9e4dae646f1f3e58";

export const loadBuyPurchases = unstable_cache(
  async (): Promise<BuyPurchase[]> => {
    const db = webDb();
    if (!db) return [];
    const rows = await recentCompetitorRates(db, 30).catch(() => []);
    return rows.map((r) => ({ at: r.at.toISOString(), corridor: r.corridor, rate: r.rate, sourceUrl: r.sourceUrl, paymentTx: r.paymentTx, paidAtomic: r.paidAtomic }));
  },
  ["buy-purchases-v1"],
  { revalidate: 60 },
);
