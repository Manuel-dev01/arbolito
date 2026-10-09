import { and, eq, ne, sql } from "drizzle-orm";
import type { LedgerEntry, SpendLedger } from "@arbolito/chain";
import type { Db } from "./client";
import { spendLedger } from "./schema";

/**
 * Postgres-backed spend ledger behind the caps. One instance per signing wallet (scope),
 * so caps hold across processes and restarts. Reservations are written before signing.
 */
export class DbLedger implements SpendLedger {
  private readonly scope: string;
  constructor(
    private readonly db: Db,
    scope: string,
  ) {
    this.scope = scope.toLowerCase();
  }

  async spent(day: string): Promise<bigint> {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${spendLedger.usdMicros}), 0)` })
      .from(spendLedger)
      .where(and(eq(spendLedger.scope, this.scope), eq(spendLedger.day, day), ne(spendLedger.status, "released")));
    return BigInt(row?.total ?? "0");
  }

  async reserve(day: string, entry: Omit<LedgerEntry, "status">): Promise<void> {
    await this.db.insert(spendLedger).values({
      id: entry.id,
      scope: this.scope,
      day,
      purpose: entry.purpose,
      usdMicros: entry.usdMicros,
      status: "reserved",
    });
  }

  async update(_day: string, id: string, patch: Partial<LedgerEntry>): Promise<void> {
    const set: Partial<typeof spendLedger.$inferInsert> = {};
    if (patch.status) set.status = patch.status;
    if (patch.txHash) set.txHash = patch.txHash;
    if (Object.keys(set).length === 0) return;
    await this.db.update(spendLedger).set(set).where(and(eq(spendLedger.id, id), eq(spendLedger.scope, this.scope)));
  }
}
