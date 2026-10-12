import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@arbolito/db";
import { contacts, linkCodes, messages, miniappQuotes, pendingActions, receipts, users } from "@arbolito/db";
import type { ChatMessage } from "@arbolito/llm";
import { langFromTelegram, type Lang } from "./i18n";
import { LINK_CODE_TTL_MS, generateLinkCode, type RandomInt } from "./link";

/** jsonb-safe values (amounts in payloads are decimal strings, never bigints). */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type User = typeof users.$inferSelect;
export type PendingAction = typeof pendingActions.$inferSelect;

/** Create the user on first contact; refresh username/display name on later ones. */
export async function upsertUser(
  db: Db,
  from: { id: number; username?: string; first_name?: string; language_code?: string },
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      telegramId: BigInt(from.id),
      telegramUsername: from.username ?? null,
      displayName: from.first_name ?? null,
      language: langFromTelegram(from.language_code),
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: { telegramUsername: from.username ?? null, displayName: from.first_name ?? null },
    })
    .returning();
  return row!;
}

export async function setLanguage(db: Db, userId: string, lang: Lang): Promise<void> {
  await db.update(users).set({ language: lang }).where(eq(users.id, userId));
}

export async function getUserById(db: Db, id: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

// ── Pending actions: the bot's Telegram quote cards ─────────────────────
// status: pending (live) | confirmed (processing) | executed | cancelled | expired | failed

/** `expiry` is a TTL in ms or an absolute time (a shared quote's expiresAt). */
export async function createPending(db: Db, userId: string, kind: "convert" | "send", payload: Json, expiry: number | Date): Promise<PendingAction> {
  const expiresAt = typeof expiry === "number" ? new Date(Date.now() + expiry) : expiry;
  const [row] = await db.insert(pendingActions).values({ userId, kind, payload, expiresAt }).returning();
  return row!;
}

/** Cards a restarted process should keep watching (and edit at expiry). */
export async function listWatchedCards(db: Db, since: Date): Promise<PendingAction[]> {
  return db
    .select()
    .from(pendingActions)
    .where(and(inArray(pendingActions.status, ["pending", "confirmed"]), gt(pendingActions.createdAt, since)));
}

/** Any card by id, regardless of owner (for the watcher; callbacks use getPending). */
export async function getCard(db: Db, id: string): Promise<PendingAction | undefined> {
  const [row] = await db.select().from(pendingActions).where(eq(pendingActions.id, id));
  return row;
}

export async function setPendingPayload(db: Db, id: string, payload: Json): Promise<void> {
  await db.update(pendingActions).set({ payload }).where(eq(pendingActions.id, id));
}

/** Only the owner can see or act on a pending action. */
export async function getPending(db: Db, id: string, userId: string): Promise<PendingAction | undefined> {
  const [row] = await db
    .select()
    .from(pendingActions)
    .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId)));
  return row;
}

/**
 * Moves a pending action from `from` to `to` atomically. Returns false if it was no longer
 * in `from` (a double tap, or another process got there first), so it can never run twice.
 */
export async function transitionPending(
  db: Db,
  id: string,
  from: string,
  to: string,
  patch: { error?: string; receiptId?: string; payload?: Json } = {},
): Promise<boolean> {
  const rows = await db
    .update(pendingActions)
    .set({ status: to, ...patch })
    .where(and(eq(pendingActions.id, id), eq(pendingActions.status, from)))
    .returning({ id: pendingActions.id });
  return rows.length === 1;
}

// ── Shared Mini App quotes (owned by the web backend; read-only here except a cancel) ──

export async function getQuoteRow(db: Db, quoteId: string): Promise<{ status: string; receiptId: string | null; error: string | null } | undefined> {
  const [row] = await db
    .select({ status: miniappQuotes.status, receiptId: miniappQuotes.receiptId, error: miniappQuotes.error })
    .from(miniappQuotes)
    .where(eq(miniappQuotes.id, quoteId));
  return row;
}

/**
 * Telegram "Cancelar": retire the shared quote so the mini app can't prepare it any more. Only
 * a quote nobody prepared yet ("quoted") can be retired; returns false otherwise.
 */
export async function retireSharedQuote(db: Db, quoteId: string): Promise<boolean> {
  const rows = await db
    .update(miniappQuotes)
    .set({ status: "expired", error: "cancelled_in_telegram" })
    .where(and(eq(miniappQuotes.id, quoteId), eq(miniappQuotes.status, "quoted")))
    .returning({ id: miniappQuotes.id });
  return rows.length === 1;
}

// ── Link codes ("Conectá tu MiniPay") ───────────────────────────────────

export type LinkCode = typeof linkCodes.$inferSelect;

/** Arbitrary constant for the advisory lock that serializes code allocation. */
const LINK_CODE_LOCK = 8_021_004;

const activeCode = (now: number) => and(isNull(linkCodes.usedAt), gt(linkCodes.expiresAt, new Date(now)));

/**
 * Creates a fresh code for the user: crypto-random, unique among active (unused, unexpired)
 * codes, 10-minute expiry. The user's previous active codes are expired first, so only the
 * newest one works. Allocation is serialized with a transaction-scoped advisory lock.
 */
export async function createLinkCode(db: Db, userId: string, opts: { now?: number; rand?: RandomInt } = {}): Promise<LinkCode> {
  const now = opts.now ?? Date.now();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LINK_CODE_LOCK})`);
    await tx
      .update(linkCodes)
      .set({ expiresAt: new Date(now) })
      .where(and(eq(linkCodes.userId, userId), activeCode(now)));
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = generateLinkCode(opts.rand);
      const [clash] = await tx
        .select({ id: linkCodes.id })
        .from(linkCodes)
        .where(and(eq(linkCodes.code, code), activeCode(now)))
        .limit(1);
      if (clash) continue;
      const [row] = await tx
        .insert(linkCodes)
        .values({ code, userId, expiresAt: new Date(now + LINK_CODE_TTL_MS) })
        .returning();
      return row!;
    }
    throw new Error("could not allocate a free link code");
  });
}

export async function getLinkCode(db: Db, id: string): Promise<LinkCode | undefined> {
  const [row] = await db.select().from(linkCodes).where(eq(linkCodes.id, id));
  return row;
}

/** Active codes with this value (allocation keeps it at most one). */
export async function countActiveCodes(db: Db, code: string, now = Date.now()): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(linkCodes)
    .where(and(eq(linkCodes.code, code), activeCode(now)));
  return row?.n ?? 0;
}

// ── Contacts ────────────────────────────────────────────────────────────

export const contactKey = (name: string) => name.normalize("NFC").trim().toLowerCase();

export async function addContact(db: Db, userId: string, name: string, address: string) {
  const [row] = await db
    .insert(contacts)
    .values({ userId, name: name.trim(), nameKey: contactKey(name), address })
    .onConflictDoUpdate({ target: [contacts.userId, contacts.nameKey], set: { address, name: name.trim() } })
    .returning();
  return row!;
}

export async function listContacts(db: Db, userId: string) {
  return db.select().from(contacts).where(eq(contacts.userId, userId)).orderBy(contacts.name);
}

export async function findContact(db: Db, userId: string, name: string) {
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.userId, userId), eq(contacts.nameKey, contactKey(name))));
  return row;
}

// ── Receipts ────────────────────────────────────────────────────────────

export async function getReceipt(db: Db, userId: string, id: string) {
  const base = db.select().from(receipts);
  if (id === "last") {
    const [row] = await base.where(eq(receipts.userId, userId)).orderBy(desc(receipts.createdAt)).limit(1);
    return row;
  }
  const [row] = await base.where(and(eq(receipts.id, id), eq(receipts.userId, userId)));
  return row;
}

// ── Conversation history ────────────────────────────────────────────────

/** The last `limit` messages, oldest first. Trimmed so a turn never starts with a dangling tool result. */
export async function loadHistory(db: Db, userId: string, limit = 20): Promise<ChatMessage[]> {
  const rows = await db
    .select({ content: messages.content })
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  const history = rows.map((r) => r.content as ChatMessage).reverse();
  while (history.length && history[0]!.role !== "user") history.shift();
  return history;
}

export async function appendHistory(db: Db, userId: string, newMessages: ChatMessage[]): Promise<void> {
  if (!newMessages.length) return;
  // Stagger timestamps so ordering by created_at is stable within one turn.
  const base = Date.now();
  await db.insert(messages).values(
    newMessages.map((m, i) => ({ userId, role: m.role, content: m as unknown as Json, createdAt: new Date(base + i) })),
  );
}

export async function countUsers(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row?.n ?? 0;
}
