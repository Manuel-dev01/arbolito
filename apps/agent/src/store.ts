import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@arbolito/db";
import { contacts, messages, pendingActions, receipts, users } from "@arbolito/db";
import type { ChatMessage } from "@arbolito/llm";
import { langFromTelegram, type Lang } from "./i18n";
import type { Json } from "./serde";

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

// ── Pending actions (quote cards waiting for a tap) ─────────────────────

export async function createPending(db: Db, userId: string, kind: "convert" | "send", payload: Json, ttlMs: number): Promise<PendingAction> {
  const [row] = await db
    .insert(pendingActions)
    .values({ userId, kind, payload, expiresAt: new Date(Date.now() + ttlMs) })
    .returning();
  return row!;
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
export async function transitionPending(db: Db, id: string, from: string, to: string, patch: { error?: string; receiptId?: string } = {}): Promise<boolean> {
  const rows = await db
    .update(pendingActions)
    .set({ status: to, ...patch })
    .where(and(eq(pendingActions.id, id), eq(pendingActions.status, from)))
    .returning({ id: pendingActions.id });
  return rows.length === 1;
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
