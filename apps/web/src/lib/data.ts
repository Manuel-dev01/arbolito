import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { proofBundleSchema, type ProofBundle } from "@arbolito/proof";
import { getDb, getPool, getReceiptRow, getSupersededRow, listReceiptRows, type Db, type ReceiptRow } from "@arbolito/db";
import { attachDatabasePool } from "@vercel/functions";

/**
 * Server-only data access for receipts. Source of truth is the `receipts` table (packages/db);
 * when DATABASE_URL is unset (local dev, tests, a build without env) or a receipt is not in the
 * DB, it falls back to the published bundles in docs/receipts/*.json.
 *
 * Records are plain JSON (no bigint) so they can sit in Next's data cache.
 */
export interface ReceiptRecord {
  /** URL id: the routeId, or "<routeId>.superseded" for a superseded file bundle. */
  id: string;
  bundle: ProofBundle;
  source: "db" | "file";
  anchorTx: string | null;
  anchorBlock: string | null;
  /** USD notional at execution in micro-USD (DB only; derived from the route otherwise). */
  usdMicros: string | null;
  /** URL id of the receipt that replaces this one. */
  supersededBy: string | null;
  /** URL id of the earlier receipt this one corrects. */
  supersedes: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPERSEDED = ".superseded";
const ID_SHAPE = /^[0-9a-f-]{36}(\.superseded)?$/i;

export const isReceiptId = (id: string) => ID_SHAPE.test(id);

// ---------------------------------------------------------------- files (fallback)

/**
 * Walks up from cwd to the first directory holding docs/receipts (repo root locally and on Vercel).
 * The files ship with the server bundle via outputFileTracingIncludes in next.config.ts, so the
 * dynamic paths below are excluded from tracing (turbopackIgnore) to avoid tracing the whole repo.
 */
export function findReceiptsDir(start = process.cwd()): string | undefined {
  let dir = resolve(/*turbopackIgnore: true*/ start);
  for (;;) {
    const candidate = join(/*turbopackIgnore: true*/ dir, "docs", "receipts");
    if (existsSync(candidate)) return candidate;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

function parseBundle(json: unknown): ProofBundle | undefined {
  const parsed = proofBundleSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

function fileRecord(dir: string, file: string, all: Set<string>): ReceiptRecord | undefined {
  const base = file.replace(/\.json$/, "");
  if (!isReceiptId(base)) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(join(/*turbopackIgnore: true*/ dir, file), "utf8"));
  } catch {
    return undefined;
  }
  const bundle = parseBundle(json);
  if (!bundle) return undefined;
  const superseded = base.endsWith(SUPERSEDED);
  const routeId = superseded ? base.slice(0, -SUPERSEDED.length) : base;
  return {
    id: base,
    bundle,
    source: "file",
    anchorTx: null,
    anchorBlock: null,
    usdMicros: null,
    supersededBy: superseded && all.has(`${routeId}.json`) ? routeId : null,
    supersedes: !superseded && all.has(`${routeId}${SUPERSEDED}.json`) ? `${routeId}${SUPERSEDED}` : null,
  };
}

export function readFileRecords(dir = findReceiptsDir()): ReceiptRecord[] {
  if (!dir || !existsSync(/*turbopackIgnore: true*/ dir)) return [];
  const files = readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => f.endsWith(".json"));
  const all = new Set(files);
  return files.map((f) => fileRecord(dir, f, all)).filter((r): r is ReceiptRecord => !!r);
}

export function readFileRecord(id: string, dir = findReceiptsDir()): ReceiptRecord | undefined {
  if (!dir || !isReceiptId(id)) return undefined;
  const file = `${id}.json`;
  if (!existsSync(join(/*turbopackIgnore: true*/ dir, file))) return undefined;
  return fileRecord(dir, file, new Set(readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => f.endsWith(".json"))));
}

// ---------------------------------------------------------------- database

let attached = false;

/** Drizzle over node-postgres on the pooled DATABASE_URL, or undefined when unset. Server only. */
export function webDb(): Db | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  const db = getDb(url);
  const pool = getPool();
  // Vercel Fluid compute: let the platform close idle clients before a function instance suspends.
  if (pool && !attached) {
    attachDatabasePool(pool);
    attached = true;
  }
  return db;
}

function rowRecord(row: ReceiptRow, supersedes: string | null): ReceiptRecord | undefined {
  const bundle = parseBundle(row.bundle);
  if (!bundle) return undefined;
  return {
    id: row.id,
    bundle,
    source: "db",
    anchorTx: row.anchorTx ?? null,
    anchorBlock: row.anchorBlock?.toString() ?? null,
    usdMicros: row.usdMicros ?? null,
    supersededBy: row.supersededBy ?? null,
    supersedes,
  };
}

function logDbError(what: string, e: unknown) {
  // Message only: connection errors can echo the host, never the password, but keep it short.
  console.error(`[receipts] ${what} failed, falling back to docs/receipts: ${e instanceof Error ? e.message.slice(0, 200) : "error"}`);
}

// ---------------------------------------------------------------- public API

export async function getReceipt(id: string): Promise<ReceiptRecord | undefined> {
  if (!isReceiptId(id)) return undefined;
  const db = UUID.test(id) ? webDb() : undefined;
  if (db) {
    try {
      const row = await getReceiptRow(db, id);
      if (row) {
        const older = await getSupersededRow(db, id);
        const rec = rowRecord(row, older?.id ?? null);
        if (rec) return rec;
      }
    } catch (e) {
      logDbError("getReceipt", e);
    }
  }
  return readFileRecord(id);
}

/** Every receipt (DB rows plus any published file bundle the DB does not have), newest first. */
export async function listReceipts(): Promise<ReceiptRecord[]> {
  const out: ReceiptRecord[] = [];
  const db = webDb();
  if (db) {
    try {
      const rows = await listReceiptRows(db);
      const replacedBy = new Map(rows.filter((r) => r.supersededBy).map((r) => [r.supersededBy!, r.id]));
      for (const row of rows) {
        const rec = rowRecord(row, replacedBy.get(row.id) ?? null);
        if (rec) out.push(rec);
      }
    } catch (e) {
      logDbError("listReceipts", e);
    }
  }
  const inDb = new Set(out.map((r) => r.bundle.routeId));
  for (const rec of readFileRecords()) if (!inDb.has(rec.bundle.routeId)) out.push(rec);
  return out.sort((a, b) => (a.bundle.createdAt < b.bundle.createdAt ? 1 : a.bundle.createdAt > b.bundle.createdAt ? -1 : 0));
}
