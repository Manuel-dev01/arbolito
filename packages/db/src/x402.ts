import { desc } from "drizzle-orm";
import type { Db } from "./client";
import { agentPurchases, x402Sales } from "./schema";

export type X402SaleRow = typeof x402Sales.$inferSelect;
export type AgentPurchaseRow = typeof agentPurchases.$inferSelect;

/** Records a settled sale; a replayed settlement (same tx) is ignored. */
export async function insertX402Sale(db: Db, row: typeof x402Sales.$inferInsert): Promise<void> {
  await db.insert(x402Sales).values(row).onConflictDoNothing({ target: x402Sales.txHash });
}

export async function recentX402Sales(db: Db, limit = 100): Promise<X402SaleRow[]> {
  return db.select().from(x402Sales).orderBy(desc(x402Sales.at)).limit(limit);
}

export async function insertAgentPurchase(db: Db, row: typeof agentPurchases.$inferInsert): Promise<string> {
  const [r] = await db.insert(agentPurchases).values(row).returning({ id: agentPurchases.id });
  return r!.id;
}

export async function recentAgentPurchases(db: Db, limit = 100): Promise<AgentPurchaseRow[]> {
  return db.select().from(agentPurchases).orderBy(desc(agentPurchases.at)).limit(limit);
}
