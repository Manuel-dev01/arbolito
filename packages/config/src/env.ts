import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// Empty strings in .env mean "unset".
const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const privateKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address");
const bool = z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() === "true" : v), z.boolean());

/** Mirrors .env.example key for key (a unit test enforces this). */
export const envSchema = z.object({
  // Chain
  CELO_RPC_URL: z.string().url().default("https://forno.celo.org"),
  CELO_RPC_URL_FALLBACK: opt(z.string().url()),
  CHAIN_ID: z.coerce.number().int().default(42220),
  ATTRIBUTION_CODE: opt(z.string().regex(/^[a-z0-9_]{1,32}$/, "ERC-8021 codes match /^[a-z0-9_]{1,32}$/")),

  // Wallets
  OPS_PRIVATE_KEY: opt(privateKey),
  DESK_PRIVATE_KEY: opt(privateKey),
  DESK_MAX_INVENTORY_USD: z.coerce.number().positive().default(500),
  DESK_ADDRESS: opt(address),
  DESK_FEED_PORT: z.coerce.number().int().positive().default(8790),
  DESK_FEED_PUBLIC_URL: z.string().url().default("https://desk-feed-production.up.railway.app"),
  BUILD_MAX_ACTION_USD: z.coerce.number().positive().default(5),
  BUILD_MAX_DAILY_USD: z.coerce.number().positive().default(25),

  // Textile
  TEXTILE_API_BASE: z.string().url().default("https://api.textilecredit.com/v2"),
  TEXTILE_PUBLIC_BASE: z.string().url().default("https://api.textilecredit.com"),
  TEXTILE_API_KEY: opt(z.string()),
  TEXTILE_WEBHOOK_SECRET: opt(z.string()),
  TEXTILE_RFQ_ENABLED: bool.default(false),

  // Reference rates
  DOLAR_API_URL: z.string().url().default("https://dolarapi.com/v1"),

  // x402 facilitator
  X402_FACILITATOR_URL: z.string().url().default("https://api.x402.celo.org"),
  X402_API_KEY: opt(z.string()),
  X402_PAY_TO: opt(address),

  // buy
  BUY_GATEWAY_URL: z.string().url().default("https://gateway.usebuy.ai"),
  BUY_COMPUTE_URL: z.string().url().default("https://usebuy.ai/google/vm"),
  BUY_PAYER_PRIVATE_KEY: opt(privateKey),
  BUY_PAY_TOKEN: z.enum(["USAT", "USDT", "USDC"]).default("USAT"),

  // LLM / speech
  LLM_PROVIDER: z.enum(["deepseek", "anthropic"]).default("deepseek"),
  DEEPSEEK_API_KEY: opt(z.string()),
  DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
  ANTHROPIC_API_KEY: opt(z.string()),
  AGENT_MODEL: z.string().default("deepseek-flash"),
  RISK_OFFICER_MODEL: z.string().default("deepseek-v4-pro"),
  STT_PROVIDER: opt(z.string()),
  STT_API_KEY: opt(z.string()),

  // Telegram
  TELEGRAM_BOT_TOKEN: opt(z.string()),
  TELEGRAM_WEBHOOK_SECRET: opt(z.string()),
  MINI_APP_URL: opt(z.string().url()),
  /** Private beta allowlist: numeric ids and/or @usernames, comma-separated. Unset = open. */
  TELEGRAM_ALLOWED_USERS: opt(z.string()),

  // Wallet infra
  THIRDWEB_CLIENT_ID: opt(z.string()),
  THIRDWEB_SECRET_KEY: opt(z.string()),

  // Identity
  ERC8004_AGENT_ID: opt(z.string()),
  SELF_AGENT_ID: opt(z.string()),

  // Data
  DATABASE_URL: opt(z.string()),
  /** Direct (non -pooler) connection, for migrations only. */
  DATABASE_URL_UNPOOLED: opt(z.string()),

  // Web
  PUBLIC_BASE_URL: opt(z.string().url()),

  // MiniPay Mini App backend (apps/web)
  /** Hot key that anchors receipts (ArbolitoReceipts emitter). Gas only; never holds user funds. */
  ANCHOR_PRIVATE_KEY: opt(privateKey),
  /** Anchor receipts from /api/miniapp/submit. Off unless explicitly "true". */
  ANCHOR_ENABLED: bool.default(false),
  /** ArbolitoGuard v2 (autonomy). Unset = autonomy endpoints answer not_ready. */
  GUARD_ADDRESS: opt(address),
  /** Operator the guard authorizes for autonomous swaps/sends (Arbolito's operator EOA). */
  ARBOLITO_OPERATOR_ADDRESS: opt(address),
});

export type Env = z.infer<typeof envSchema>;

/** Walks up from cwd to the workspace root (the dir holding pnpm-workspace.yaml). */
export function findRepoRoot(start = process.cwd()): string {
  // turbopackIgnore: a runtime walk-up; keeps Next.js (apps/web) from tracing the whole repo.
  let dir = resolve(/*turbopackIgnore: true*/ start);
  for (;;) {
    if (existsSync(join(/*turbopackIgnore: true*/ dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(/*turbopackIgnore: true*/ start);
    dir = up;
  }
}

let cached: Env | undefined;

/** Loads `.env` from the repo root (if present) and validates it. Never logs values. */
export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const path = join(findRepoRoot(), ".env");
  if (existsSync(path)) loadDotenv({ path, quiet: true });
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    // Report key names and messages only, never values.
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  if (Object.keys(overrides).length === 0) cached = parsed.data;
  return parsed.data;
}
