/**
 * Arbolito Telegram bot (long polling via @grammyjs/runner).
 * Run: pnpm --filter @arbolito/agent start
 * Needs TELEGRAM_BOT_TOKEN, DATABASE_URL, DEEPSEEK_API_KEY, STT_API_KEY, and PUBLIC_BASE_URL
 * (the web backend that issues the shared quotes). MINI_APP_URL is where "Confirmar en MiniPay"
 * and "Conectar en MiniPay" point (defaults to PUBLIC_BASE_URL). The bot never moves money:
 * users confirm in their own MiniPay wallet.
 */
import { run } from "@grammyjs/runner";
import { loadEnv } from "@arbolito/config";
import { log } from "@arbolito/chain";
import { closeDb, getDb } from "@arbolito/db";
import { createBot } from "./bot";
import { startRulesRunner } from "./rules";

const env = loadEnv();
if (!env.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set (see docs/07-keys-setup.md)");
if (!env.PUBLIC_BASE_URL) log("[bot] PUBLIC_BASE_URL is not set: quotes will fail until it points at the web app");
if (!env.MINI_APP_URL) log("[bot] MINI_APP_URL is not set: mini app links fall back to PUBLIC_BASE_URL");

const { bot, flow, linker } = createBot(env.TELEGRAM_BOT_TOKEN);
await bot.init();
// The "/" menu in Telegram, per language (es is the default for every other language).
const COMMANDS = {
  es: [
    { command: "conectar", description: "Conectar tu MiniPay (te doy un código)" },
    { command: "start", description: "Empezar" },
    { command: "quote", description: "Cotizar, ej. /quote USDT wARS 100" },
  ],
  pt: [
    { command: "conectar", description: "Conectar seu MiniPay (te dou um código)" },
    { command: "start", description: "Começar" },
    { command: "quote", description: "Cotar, ex. /quote USDT wBRL 100" },
  ],
  en: [
    { command: "connect", description: "Connect your MiniPay (I'll give you a code)" },
    { command: "start", description: "Start" },
    { command: "quote", description: "Quote, e.g. /quote USDT wARS 100" },
  ],
};
await Promise.all([
  bot.api.setMyCommands(COMMANDS.es),
  bot.api.setMyCommands(COMMANDS.pt, { language_code: "pt" }),
  bot.api.setMyCommands(COMMANDS.en, { language_code: "en" }),
]).catch((err) => log(`[bot] setMyCommands failed: ${(err as Error).message}`));
log(`[bot] @${bot.botInfo.username} starting (model ${env.AGENT_MODEL}, LLM ${env.LLM_PROVIDER})`);

const resumed = await flow.resume().catch((err) => {
  log(`[bot] resuming card watchers failed: ${(err as Error).message}`);
  return 0;
});
if (resumed) log(`[bot] watching ${resumed} live card(s) from before the restart`);

const runner = run(bot);
// Standing rules (RULES_RUNNER=live): runs through ArbolitoGuard with the operator key.
const stopRules = startRulesRunner(getDb(), bot.api, env);

const stop = async () => {
  log("[bot] stopping");
  flow.stop();
  linker.stop();
  stopRules?.();
  if (runner.isRunning()) await runner.stop();
  await closeDb();
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
