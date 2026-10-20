import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "./client";
import { ruleRuns, rules } from "./schema";

export type RuleRow = typeof rules.$inferSelect;
export type RuleRunRow = typeof ruleRuns.$inferSelect;

/** A draft the account still has to sign. The id is chosen by the caller (it is part of the signed text). */
export async function insertRuleDraft(db: Db, r: { id: string; account: string; kind: string; params: unknown; lang: string; message: string }): Promise<RuleRow> {
  const [row] = await db
    .insert(rules)
    .values({ ...r, account: r.account.toLowerCase(), status: "draft" })
    .returning();
  return row!;
}

export async function getRule(db: Db, id: string): Promise<RuleRow | undefined> {
  const [row] = await db.select().from(rules).where(eq(rules.id, id)).limit(1);
  return row;
}

/** draft → active, once. Returns false if the rule wasn't a draft any more. */
export async function activateRule(db: Db, id: string, a: { signature: string; nextRunAt: Date | null; cursorBlock: bigint | null; now: Date }): Promise<boolean> {
  const rows = await db
    .update(rules)
    .set({ status: "active", signature: a.signature, confirmedAt: a.now, nextRunAt: a.nextRunAt, cursorBlock: a.cursorBlock })
    .where(and(eq(rules.id, id), eq(rules.status, "draft")))
    .returning({ id: rules.id });
  return rows.length === 1;
}

/** Cancelled by the account (draft, active, or stopped by the runner). */
export async function cancelRule(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(rules)
    .set({ status: "cancelled", nextRunAt: null })
    .where(and(eq(rules.id, id), inArray(rules.status, ["draft", "active", "stopped"])))
    .returning({ id: rules.id });
  return rows.length === 1;
}

/** Stopped by the runner (a failure it won't retry); the account sees the reason. */
export async function stopRule(db: Db, id: string, reason: string): Promise<void> {
  await db.update(rules).set({ status: "stopped", stoppedReason: reason.slice(0, 500), nextRunAt: null }).where(eq(rules.id, id));
}

export async function listRules(db: Db, account: string): Promise<RuleRow[]> {
  return db
    .select()
    .from(rules)
    .where(and(eq(rules.account, account.toLowerCase()), inArray(rules.status, ["active", "stopped", "draft"])))
    .orderBy(desc(rules.createdAt))
    .limit(50);
}

/** Active sends that are due. */
export async function dueSendRules(db: Db, now: Date): Promise<RuleRow[]> {
  return db
    .select()
    .from(rules)
    .where(and(eq(rules.status, "active"), eq(rules.kind, "send"), lte(rules.nextRunAt, now)))
    .orderBy(asc(rules.nextRunAt));
}

export async function activeSplitRules(db: Db): Promise<RuleRow[]> {
  return db.select().from(rules).where(and(eq(rules.status, "active"), eq(rules.kind, "split")));
}

export async function setNextRun(db: Db, id: string, at: Date): Promise<void> {
  await db.update(rules).set({ nextRunAt: at }).where(and(eq(rules.id, id), eq(rules.status, "active")));
}

export async function setCursor(db: Db, id: string, block: bigint): Promise<void> {
  await db.update(rules).set({ cursorBlock: block }).where(eq(rules.id, id));
}

/**
 * Claims a run before anything is sent. Null when this (rule, trigger) already has a run: the
 * runner then skips it, so a crash or a restart can never execute the same month or payment twice.
 */
export async function claimRun(db: Db, ruleId: string, trigger: string, amountIn: bigint | null): Promise<RuleRunRow | null> {
  const rows = await db
    .insert(ruleRuns)
    .values({ ruleId, trigger, status: "running", amountIn: amountIn?.toString() ?? null })
    .onConflictDoNothing({ target: [ruleRuns.ruleId, ruleRuns.trigger] })
    .returning();
  return rows[0] ?? null;
}

export async function finishRun(db: Db, id: string, r: { status: "done" | "partial" | "failed" | "skipped"; amountOut?: bigint | null; txHashes: string[]; error?: string | null }): Promise<void> {
  await db
    .update(ruleRuns)
    .set({ status: r.status, amountOut: r.amountOut?.toString() ?? null, txHashes: r.txHashes, error: r.error?.slice(0, 1000) ?? null })
    .where(eq(ruleRuns.id, id));
}

/** The latest runs of one account's rules, newest first. */
export async function runsForAccount(db: Db, account: string, limit = 20): Promise<(RuleRunRow & { kind: string })[]> {
  return db
    .select({ run: ruleRuns, kind: rules.kind })
    .from(ruleRuns)
    .innerJoin(rules, eq(ruleRuns.ruleId, rules.id))
    .where(eq(rules.account, account.toLowerCase()))
    .orderBy(desc(ruleRuns.createdAt))
    .limit(limit)
    .then((rows) => rows.map((r) => ({ ...r.run, kind: r.kind })));
}

/** Runs left in "running" (a crash mid-run): never retried automatically; surfaced for a human. */
export async function staleRuns(db: Db, olderThan: Date): Promise<RuleRunRow[]> {
  return db.select().from(ruleRuns).where(and(eq(ruleRuns.status, "running"), sql`${ruleRuns.updatedAt} < ${olderThan}`));
}
