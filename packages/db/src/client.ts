import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnv } from "@arbolito/config";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let pool: pg.Pool | undefined;
let db: Db | undefined;

/**
 * Shared Drizzle client over node-postgres, on the pooled DATABASE_URL (PgBouncer).
 * One pool per process: the Railway bot reuses it for its lifetime; on Vercel Fluid,
 * pass the pool to attachDatabasePool() from @vercel/functions.
 */
export function getDb(url = loadEnv().DATABASE_URL): Db {
  if (db) return db;
  if (!url) throw new Error("DATABASE_URL is not set (see docs/07-keys-setup.md)");
  pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  // An idle client's connection can die (database restart, PgBouncer recycling). Without a listener
  // node-postgres re-emits it as an uncaught error and the whole process (bot, runners) exits.
  pool.on("error", (err) => console.error(`[db] idle connection error: ${err.message}`));
  db = drizzle(pool, { schema, casing: "snake_case" });
  return db;
}

export function getPool(): pg.Pool | undefined {
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
