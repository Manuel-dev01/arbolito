import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "drizzle-kit";

// Migrations run on the DIRECT (non -pooler) connection: PgBouncer's transaction
// pooling breaks migration tools.
const envFile = resolve(__dirname, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set");
if (new URL(url).hostname.includes("-pooler")) throw new Error("DATABASE_URL_UNPOOLED points at the pooler; use the direct host");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
