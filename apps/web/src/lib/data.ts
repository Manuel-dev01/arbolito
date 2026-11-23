import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { proofBundleSchema, type ProofBundle } from "@arbolito/proof";
import { getDb, getPool, getReceiptRow, getSupersededRow, listReceiptRows, type Db, type ReceiptRow } from "@arbolito/db";
import { attachDatabasePool } from "@vercel/functions";

/**
 * Server-only data access for receipts. Source of truth is the `receipts` table (packages/db);
 * when DATABASE_URL is unset (local dev, tests, a build without env) or a receipt is not in the
 * DB, it falls back to the published bundles in docs/receipts/*.json. A failed query throws: the
 * cached wrappers (cached.ts) must not store a fallback as if it were the answer (2026-11-23:
 * /metrics showed 1 wallet for minutes after a few failed queries).
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

/** Drizzle's message is only the SQL; what went wrong is in its cause. Connection errors can echo the host, never the password. */
function dbError(e: unknown): string {
  const c = (e instanceof Error && e.cause ? e.cause : e) as { code?: unknown; message?: unknown };
  return `${c?.code ? `${String(c.code)} ` : ""}${String(c?.message ?? "error").slice(0, 160)}`;
}

/** One read, tried twice: a connection that died while the instance was idle fails its first query. */
async function read<T>(what: string, query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (e) {
    console.error(`[receipts] ${what} failed, retrying once: ${dbError(e)}`);
    await new Promise((ok) => setTimeout(ok, 250));
    try {
      return await query();
    } catch (again) {
      console.error(`[receipts] ${what} failed: ${dbError(again)}`);
      throw again;
    }
  }
}

// ---------------------------------------------------------------- public API

export async function getReceipt(id: string): Promise<ReceiptRecord | undefined> {
  if (!isReceiptId(id)) return undefined;
  const db = UUID.test(id) ? webDb() : undefined;
  if (db) {
    try {
      const rec = await read("getReceipt", async () => {
        const row = await getReceiptRow(db, id);
        return row ? rowRecord(row, (await getSupersededRow(db, id))?.id ?? null) : undefined;
      });
      if (rec) return rec;
    } catch (e) {
      // "We couldn't look" is not "it doesn't exist".
      const file = readFileRecord(id);
      if (!file) throw e;
      return file;
    }
  }
  return readFileRecord(id);
}

const newestFirst = (list: ReceiptRecord[]) => list.sort((a, b) => (a.bundle.createdAt < b.bundle.createdAt ? 1 : a.bundle.createdAt > b.bundle.createdAt ? -1 : 0));

/** Only the published bundles, newest first: what a page shows when the database can't be read. */
export const listFileReceipts = (): ReceiptRecord[] => newestFirst(readFileRecords());

/** Every receipt (DB rows plus any published file bundle the DB does not have), newest first. Throws when the DB can't be read. */
export async function listReceipts(): Promise<ReceiptRecord[]> {
  const out: ReceiptRecord[] = [];
  const db = webDb();
  if (db) {
    const rows = await read("listReceipts", () => listReceiptRows(db));
    const replacedBy = new Map(rows.filter((r) => r.supersededBy).map((r) => [r.supersededBy!, r.id]));
    for (const row of rows) {
      const rec = rowRecord(row, replacedBy.get(row.id) ?? null);
      if (rec) out.push(rec);
    }
  }
  const inDb = new Set(out.map((r) => r.bundle.routeId));
  for (const rec of readFileRecords()) if (!inDb.has(rec.bundle.routeId)) out.push(rec);
  return newestFirst(out);
}
