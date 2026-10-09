import { bigint, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Money columns are numeric(78,0): atomic units (or micro-USD) as exact decimal strings.
 * Convert to bigint at the edge; never store floats. Column names map to snake_case
 * through the `casing` option in client.ts and drizzle.config.ts.
 */
const atomic = () => numeric({ precision: 78, scale: 0 });
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  telegramId: bigint({ mode: "bigint" }).notNull().unique(),
  telegramUsername: text(),
  displayName: text(),
  /** es | pt | en */
  language: text().notNull().default("es"),
  walletAddress: text(),
  /** smart | server_eoa (decided in the Phase 2 wallet spike) */
  walletKind: text(),
  /** Per-user caps in micro-USD. Product defaults: $25 per action, $100/day. */
  maxActionMicros: atomic().notNull().default("25000000"),
  maxDailyMicros: atomic().notNull().default("100000000"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contacts = pgTable(
  "contacts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Lowercased, trimmed name for lookups ("Lucía" → "lucía"). */
    nameKey: text().notNull(),
    /** Recipient wallet; null if the contact is an Arbolito user resolved via contactUserId. */
    address: text(),
    contactUserId: uuid().references(() => users.id, { onDelete: "set null" }),
    /** Token the contact prefers to receive (e.g. wARS), if known. */
    preferredToken: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("contacts_user_name_key").on(t.userId, t.nameKey)],
);

/** One row per executed route. The bundle JSON is what /r/:id serves and anyone can re-hash. */
export const receipts = pgTable(
  "receipts",
  {
    /** = ProofBundle.routeId (UUID) */
    id: uuid().primaryKey(),
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    bundleHash: text().notNull().unique(),
    bundle: jsonb().notNull(),
    tokenIn: text().notNull(),
    tokenOut: text().notNull(),
    amountIn: atomic().notNull(),
    amountOut: atomic().notNull(),
    usdMicros: atomic().notNull(),
    taker: text().notNull(),
    executionTx: text().notNull().unique(),
    executionBlock: bigint({ mode: "bigint" }).notNull(),
    anchorTx: text(),
    anchorBlock: bigint({ mode: "bigint" }),
    savingsBps: integer(),
    /** Set when a corrected bundle replaces this one (see scripts/reanchor-receipt.ts). */
    supersededBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [index("receipts_user_idx").on(t.userId, t.createdAt), index("receipts_created_idx").on(t.createdAt)],
);

/**
 * Persistent spend ledger behind the caps (replaces .arbolito/spend-ledger.json).
 * scope = lowercased signer address, so caps hold per wallet across processes.
 */
export const spendLedger = pgTable(
  "spend_ledger",
  {
    id: uuid().primaryKey(),
    scope: text().notNull(),
    day: date().notNull(),
    purpose: text().notNull(),
    usdMicros: atomic().notNull(),
    /** reserved | sent | confirmed | released */
    status: text().notNull(),
    txHash: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("spend_ledger_scope_day_idx").on(t.scope, t.day)],
);

/** A quote card waiting for the user's tap (Confirmar / Cancelar), with its expiry. */
export const pendingActions = pgTable(
  "pending_actions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** convert | send */
    kind: text().notNull(),
    /** Serialized request + chosen route + alternatives (bigints as decimal strings). */
    payload: jsonb().notNull(),
    /** pending | confirmed | executed | cancelled | expired | failed */
    status: text().notNull().default("pending"),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    receiptId: uuid(),
    error: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("pending_actions_user_status_idx").on(t.userId, t.status)],
);

/** Agent conversation history, per user (kept short; trimmed by the agent). */
export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** user | assistant | tool */
    role: text().notNull(),
    content: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_user_created_idx").on(t.userId, t.createdAt)],
);

