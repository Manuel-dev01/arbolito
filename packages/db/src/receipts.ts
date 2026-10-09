import { desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { receipts } from "./schema";

export type ReceiptRow = typeof receipts.$inferSelect;

/** One receipt by id (= ProofBundle.routeId). */
export async function getReceiptRow(db: Db, id: string): Promise<ReceiptRow | undefined> {
  const [row] = await db.select().from(receipts).where(eq(receipts.id, id)).limit(1);
  return row;
}

/** The receipt that an earlier, superseded row points to as its replacement (if any). */
export async function getSupersededRow(db: Db, replacementId: string): Promise<ReceiptRow | undefined> {
  const [row] = await db.select().from(receipts).where(eq(receipts.supersededBy, replacementId)).limit(1);
  return row;
}

/** Newest first. Superseded rows are included; callers decide whether to count them. */
export async function listReceiptRows(db: Db, limit = 1000): Promise<ReceiptRow[]> {
  return db.select().from(receipts).orderBy(desc(receipts.createdAt)).limit(limit);
}
