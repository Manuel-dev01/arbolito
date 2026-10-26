import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { activateRule, cancelRule, getRule, insertRuleDraft, isPaused, setPause, linkCodes, listRules, messages, miniappQuotes, receipts, runsForAccount, users, type Db, type RuleRow, type RuleRunRow } from "@arbolito/db";
import type { ChatMessage } from "@arbolito/llm";

/**
 * Persistence for the Mini App backend. Route logic talks to this interface only, so unit tests
 * run against an in-memory implementation (apps/web/test/miniapp-helpers.ts) and production
 * against Postgres via Drizzle (DrizzleStore). Wallet addresses are stored lowercased.
 */

export type UserRow = typeof users.$inferSelect;
export type QuoteRow = typeof miniappQuotes.$inferSelect;
export type NewQuote = Pick<typeof miniappQuotes.$inferInsert, "account" | "fromSym" | "toSym" | "amountIn" | "payload" | "expiresAt">;
export type QuotePatch = Partial<Pick<QuoteRow, "status" | "prepared" | "receiptId" | "error" | "account" | "expiresAt">>;
export type ReceiptRow = typeof receipts.$inferSelect;
export type NewReceipt = typeof receipts.$inferInsert;
export type LinkCodeRow = typeof linkCodes.$inferSelect;
export type { RuleRow, RuleRunRow };
export interface NewRuleDraft {
  id: string;
  account: string;
  kind: string;
  params: unknown;
  lang: string;
  message: string;
}

export interface MiniappStore {
  /** The user owning this wallet, creating a MiniPay-only user (no Telegram id) on first sight. */
  walletUser(wallet: string, language?: string): Promise<UserRow>;
  userByWallet(wallet: string): Promise<UserRow | undefined>;
  userById(id: string): Promise<UserRow | undefined>;
  setUserWallet(userId: string, wallet: string): Promise<void>;
  deleteUser(id: string): Promise<void>;
  /** Re-own receipts and chat history (used when merging a MiniPay-only user into a Telegram user). */
  moveUserData(fromUserId: string, toUserId: string): Promise<void>;

  insertQuote(q: NewQuote): Promise<QuoteRow>;
  getQuote(id: string): Promise<QuoteRow | undefined>;
  /** The account's newest quote still `quoted` and unexpired at `now` (e.g. one made from Telegram). */
  latestOpenQuote(account: string, now: Date): Promise<QuoteRow | undefined>;
  /** Applies the patch only while the status is one of `fromStatus` (atomic). True if a row changed. */
  updateQuote(id: string, patch: QuotePatch, fromStatus?: readonly string[]): Promise<boolean>;

  /** False when a row with the same id or execution tx already exists (nothing written). */
  insertReceipt(r: NewReceipt): Promise<boolean>;
  getReceipt(id: string): Promise<ReceiptRow | undefined>;
  receiptByExecutionTx(txHash: string): Promise<ReceiptRow | undefined>;
  /** The newest receipts this wallet made (as taker), newest first. */
  receiptsByTaker(taker: string, limit: number): Promise<ReceiptRow[]>;
  setReceiptAnchor(id: string, anchorTx: string, anchorBlock: bigint): Promise<void>;

  /** Last `limit` messages, oldest first, never starting with a dangling assistant/tool message. */
  loadHistory(userId: string, limit: number): Promise<ChatMessage[]>;
  appendHistory(userId: string, msgs: ChatMessage[]): Promise<void>;

  /** Unused, unexpired codes equal to `code`, newest first. */
  activeLinkCodes(code: string, now: Date): Promise<LinkCodeRow[]>;
  /** Marks the code used by `account` if it is still unused (atomic). */
  useLinkCode(id: string, account: string, now: Date): Promise<boolean>;

  transaction<T>(fn: (s: MiniappStore) => Promise<T>): Promise<T>;

  // Standing rules (packages/rules)
  insertRuleDraft(r: NewRuleDraft): Promise<RuleRow>;
  getRule(id: string): Promise<RuleRow | undefined>;
  /** draft → active, once; false if it wasn't a draft. */
  activateRule(id: string, a: { signature: string; nextRunAt: Date | null; cursorBlock: bigint | null; now: Date }): Promise<boolean>;
  cancelRule(id: string): Promise<boolean>;
  /** Draft, active and stopped rules of an account, newest first. */
  listRules(account: string): Promise<RuleRow[]>;
  ruleRuns(account: string, limit: number): Promise<(RuleRunRow & { kind: string })[]>;
  /** "Pause Arbolito": signed, off chain, honoured by the rules runner. */
  isPaused(account: string): Promise<boolean>;
  /** False when a newer signed pause/resume is already stored. */
  setPause(account: string, p: { paused: boolean; signedAt: Date; signature: string }): Promise<boolean>;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class DrizzleStore implements MiniappStore {
  constructor(private readonly db: Db | Tx) {}

  async walletUser(wallet: string, language?: string): Promise<UserRow> {
    const w = wallet.toLowerCase();
    await this.db
      .insert(users)
      .values({ walletAddress: w, ...(language ? { language } : {}) })
      .onConflictDoNothing({ target: users.walletAddress });
    const row = await this.userByWallet(w);
    if (!row) throw new Error("wallet user upsert returned nothing");
    return row;
  }

  async userByWallet(wallet: string) {
    const [row] = await this.db.select().from(users).where(eq(users.walletAddress, wallet.toLowerCase())).limit(1);
    return row;
  }

  async userById(id: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  async setUserWallet(userId: string, wallet: string) {
    await this.db.update(users).set({ walletAddress: wallet.toLowerCase() }).where(eq(users.id, userId));
  }

  async deleteUser(id: string) {
    await this.db.delete(users).where(eq(users.id, id));
  }

  async moveUserData(fromUserId: string, toUserId: string) {
    await this.db.update(receipts).set({ userId: toUserId }).where(eq(receipts.userId, fromUserId));
    await this.db.update(messages).set({ userId: toUserId }).where(eq(messages.userId, fromUserId));
  }

  async insertQuote(q: NewQuote) {
    const [row] = await this.db.insert(miniappQuotes).values(q).returning();
    return row!;
  }

  async getQuote(id: string) {
    const [row] = await this.db.select().from(miniappQuotes).where(eq(miniappQuotes.id, id)).limit(1);
    return row;
  }

  async latestOpenQuote(account: string, now: Date) {
    const [row] = await this.db
      .select()
      .from(miniappQuotes)
      .where(and(eq(miniappQuotes.account, account.toLowerCase()), eq(miniappQuotes.status, "quoted"), gt(miniappQuotes.expiresAt, now)))
      .orderBy(desc(miniappQuotes.createdAt))
      .limit(1);
    return row;
  }

  async updateQuote(id: string, patch: QuotePatch, fromStatus?: readonly string[]) {
    const where = fromStatus ? and(eq(miniappQuotes.id, id), inArray(miniappQuotes.status, [...fromStatus])) : eq(miniappQuotes.id, id);
    const rows = await this.db.update(miniappQuotes).set(patch).where(where).returning({ id: miniappQuotes.id });
    return rows.length === 1;
  }

  async insertReceipt(r: NewReceipt) {
    const rows = await this.db.insert(receipts).values(r).onConflictDoNothing().returning({ id: receipts.id });
    return rows.length === 1;
  }

  async getReceipt(id: string) {
    const [row] = await this.db.select().from(receipts).where(eq(receipts.id, id)).limit(1);
    return row;
  }

  async receiptByExecutionTx(txHash: string) {
    const [row] = await this.db.select().from(receipts).where(eq(receipts.executionTx, txHash)).limit(1);
    return row;
  }

  async receiptsByTaker(taker: string, limit: number) {
    return this.db.select().from(receipts).where(eq(receipts.taker, taker.toLowerCase())).orderBy(desc(receipts.createdAt)).limit(limit);
  }

  async setReceiptAnchor(id: string, anchorTx: string, anchorBlock: bigint) {
    await this.db.update(receipts).set({ anchorTx, anchorBlock }).where(eq(receipts.id, id));
  }

  async loadHistory(userId: string, limit: number) {
    const rows = await this.db
      .select({ content: messages.content })
      .from(messages)
      .where(eq(messages.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return trimHistory(rows.map((r) => r.content as ChatMessage).reverse());
  }

  async appendHistory(userId: string, msgs: ChatMessage[]) {
    if (!msgs.length) return;
    // Stagger timestamps so ordering by created_at is stable within one turn.
    const base = Date.now();
    await this.db.insert(messages).values(msgs.map((m, i) => ({ userId, role: m.role, content: m as unknown, createdAt: new Date(base + i) })));
  }

  async activeLinkCodes(code: string, now: Date) {
    return this.db
      .select()
      .from(linkCodes)
      .where(and(eq(linkCodes.code, code), isNull(linkCodes.usedAt), gt(linkCodes.expiresAt, now)))
      .orderBy(desc(linkCodes.createdAt));
  }

  async useLinkCode(id: string, account: string, now: Date) {
    const rows = await this.db
      .update(linkCodes)
      .set({ usedAt: now, account: account.toLowerCase() })
      .where(and(eq(linkCodes.id, id), isNull(linkCodes.usedAt)))
      .returning({ id: linkCodes.id });
    return rows.length === 1;
  }

  insertRuleDraft(r: NewRuleDraft) {
    return insertRuleDraft(this.db as Db, r);
  }
  getRule(id: string) {
    return getRule(this.db as Db, id);
  }
  activateRule(id: string, a: { signature: string; nextRunAt: Date | null; cursorBlock: bigint | null; now: Date }) {
    return activateRule(this.db as Db, id, a);
  }
  cancelRule(id: string) {
    return cancelRule(this.db as Db, id);
  }
  listRules(account: string) {
    return listRules(this.db as Db, account);
  }
  ruleRuns(account: string, limit: number) {
    return runsForAccount(this.db as Db, account, limit);
  }
  isPaused(account: string) {
    return isPaused(this.db as Db, account);
  }
  setPause(account: string, p: { paused: boolean; signedAt: Date; signature: string }) {
    return setPause(this.db as Db, account, p);
  }

  async transaction<T>(fn: (s: MiniappStore) => Promise<T>): Promise<T> {
    if (!("transaction" in this.db)) return fn(this);
    return (this.db as Db).transaction((tx) => fn(new DrizzleStore(tx)));
  }
}

/** Drops leading messages until the history starts with a user turn (no dangling tool results). */
export function trimHistory(history: ChatMessage[]): ChatMessage[] {
  const out = [...history];
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}
