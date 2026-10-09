/**
 * Arbolito Telegram bot (long polling via @grammyjs/runner).
 * Run: pnpm --filter @arbolito/agent start   (needs TELEGRAM_BOT_TOKEN, DATABASE_URL, DEEPSEEK_API_KEY, STT_API_KEY)
 * Confirm buttons don't execute yet: execution via smart accounts lands with the guard contract.
 */
import { run } from "@grammyjs/runner";
import { loadEnv } from "@arbolito/config";
import { log } from "@arbolito/chain";
import { closeDb } from "@arbolito/db";
import { createBot } from "./bot";

const env = loadEnv();
if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set (see docs/07-keys-setup.md)");

const bot = createBot(env.TELEGRAM_BOT_TOKEN);
await bot.init();
log(`[bot] @${bot.botInfo.username} starting (model ${env.AGENT_MODEL}, LLM ${env.LLM_PROVIDER})`);

const runner = run(bot);

const stop = async () => {
  log("[bot] stopping");
  if (runner.isRunning()) await runner.stop();
  await closeDb();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
