import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "./client";
import { competitorRates } from "./schema";

export type CompetitorRateRow = typeof competitorRates.$inferSelect;

export async function insertCompetitorRates(db: Db, rows: (typeof competitorRates.$inferInsert)[]): Promise<void> {
  if (rows.length) await db.insert(competitorRates).values(rows);
}

/** The newest reading per corridor for a provider, if it's at most maxAgeMs old. */
export async function latestCompetitorRates(db: Db, provider: string, maxAgeMs: number, now = Date.now()): Promise<CompetitorRateRow[]> {
  const rows = await db
    .select()
    .from(competitorRates)
    .where(and(eq(competitorRates.provider, provider), gte(competitorRates.at, new Date(now - maxAgeMs))))
    .orderBy(desc(competitorRates.at))
    .limit(50);
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.corridor) ? false : (seen.add(r.corridor), true)));
}

/** Recent readings (each with the buy payment that fetched it), newest first: the proof list on /metrics. */
export async function recentCompetitorRates(db: Db, limit = 30): Promise<CompetitorRateRow[]> {
  return db.select().from(competitorRates).orderBy(desc(competitorRates.at)).limit(limit);
}
