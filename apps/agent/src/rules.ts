/**
 * Runs users' standing rules from the bot process (long-lived, already holds the database and
 * Telegram). Enabled with RULES_RUNNER=live plus the operator key, the guard address and the
 * attribution code. Linked users get a Telegram message after every run.
 */
import { eq } from "drizzle-orm";
import type { Api } from "grammy";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Env } from "@arbolito/config";
import { log, makePublicClient, makeWalletClient } from "@arbolito/chain";
import { DbLedger, activeSplitRules, claimRun, dueSendRules, finishRun, setCursor, setNextRun, stopRule, users, type Db } from "@arbolito/db";
import { RulesRunner, type RunnerStore } from "@arbolito/rules/runner";

const TICK_MS = 60_000;

function dbStore(db: Db): RunnerStore {
  return {
    dueSendRules: (now) => dueSendRules(db, now),
    activeSplitRules: () => activeSplitRules(db),
    claimRun: (ruleId, trigger, amountIn) => claimRun(db, ruleId, trigger, amountIn),
    finishRun: (id, r) => finishRun(db, id, r),
    setNextRun: (id, at) => setNextRun(db, id, at),
    setCursor: (id, block) => setCursor(db, id, block),
    stopRule: (id, reason) => stopRule(db, id, reason),
  };
}

/** Starts the runner when configured; returns a stop function (or null when it's off). */
export function startRulesRunner(db: Db, api: Api, env: Env): (() => void) | null {
  if (env.RULES_RUNNER !== "live") return null;
  if (!env.ARBOLITO_OPERATOR_PRIVATE_KEY || !env.GUARD_ADDRESS || !env.ATTRIBUTION_CODE) {
    log("[rules] RULES_RUNNER=live but the operator key, GUARD_ADDRESS or ATTRIBUTION_CODE is missing: not running");
    return null;
  }
  const operator = privateKeyToAccount(env.ARBOLITO_OPERATOR_PRIVATE_KEY as Hex);
  const runner = new RulesRunner({
    store: dbStore(db),
    publicClient: makePublicClient(),
    operator,
    walletClient: makeWalletClient(operator),
    guard: env.GUARD_ADDRESS as Address,
    mode: "live",
    ledger: new DbLedger(db, operator.address),
    log,
    async notify(account, text) {
      const [u] = await db.select({ telegramId: users.telegramId }).from(users).where(eq(users.walletAddress, account.toLowerCase())).limit(1);
      if (u?.telegramId) await api.sendMessage(Number(u.telegramId), text, { link_preview_options: { is_disabled: true } });
    },
  });
  log(`[rules] runner on: operator ${operator.address}, guard ${env.GUARD_ADDRESS}, every ${TICK_MS / 1000}s`);
  void runner.tick();
  const timer = setInterval(() => void runner.tick(), TICK_MS);
  return () => clearInterval(timer);
}
