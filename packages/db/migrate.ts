/**
 * pnpm db:migrate: applies packages/db/drizzle migrations on the DIRECT (non -pooler) connection.
 * Uses drizzle-orm's migrator because the drizzle-kit CLI hung silently on this setup.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { loadEnv } from "@arbolito/config";

const url = loadEnv().DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set");
if (new URL(url).hostname.includes("-pooler")) throw new Error("migrations need the direct (non -pooler) URL");
const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 20_000 });
const t0 = Date.now();
await migrate(drizzle(pool), { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "drizzle") });
console.log(`migrations applied in ${Date.now() - t0} ms`);
await pool.end();
