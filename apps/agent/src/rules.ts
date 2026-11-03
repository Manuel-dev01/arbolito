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
import { DbLedger, activeGuardianRules, activeSplitRules, claimRun, dueSendRules, finishRun, isPaused, setCursor, setNextRun, stopRule, users, type Db } from "@arbolito/db";
import type { GuardianSignal, GuardianSym } from "@arbolito/rules";
import { RulesRunner, type RunnerStore } from "@arbolito/rules/runner";

const TICK_MS = 60_000;

function dbStore(db: Db): RunnerStore {
  return {
    dueSendRules: (now) => dueSendRules(db, now),
    activeSplitRules: () => activeSplitRules(db),
    activeGuardianRules: () => activeGuardianRules(db),
    claimRun: (ruleId, trigger, amountIn) => claimRun(db, ruleId, trigger, amountIn),
    finishRun: (id, r) => finishRun(db, id, r),
    setNextRun: (id, at) => setNextRun(db, id, at),
    setCursor: (id, block) => setCursor(db, id, block),
    stopRule: (id, reason) => stopRule(db, id, reason),
    isPaused: (account) => isPaused(db, account),
  };
}

const DESK_PAIR: Record<GuardianSym, string> = { wARS: "wars-usdt", wBRL: "wbrl-usdt" };

interface FeedCorridor {
  pair: string;
  dynamic?: { carry?: { bpsPerDay: number; source: "measured" | "prior" } };
  decisions: { action: string; fiatPerUsd?: number; at: string }[];
}

/**
 * The guardian's signal from Arbolito Desk's public feed: fair price, measured carry (a robust
 * one-week trend) and whether the breaker is holding the currency. Null when the feed is down or
 * stale (over 10 minutes), so the guardian holds rather than acting on old prices.
 */
export function deskSignal(feedUrl: string): (sym: GuardianSym) => Promise<GuardianSignal | null> {
  return async (sym) => {
    try {
      const res = await fetch(`${feedUrl.replace(/\/$/, "")}/state`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const state = (await res.json()) as { corridors?: FeedCorridor[] };
      const c = state.corridors?.find((x) => x.pair === DESK_PAIR[sym]);
      const last = c?.decisions.at(-1);
      if (!c || !last || Date.now() - Date.parse(last.at) > 10 * 60_000) return null;
      const fair = c.decisions.findLast((d) => d.action === "publish" && d.fiatPerUsd)?.fiatPerUsd;
      const carry = c.dynamic?.carry;
      if (!fair || !carry) return null;
      return { fiatPerUsd: fair, carryBpsPerDay: carry.bpsPerDay, carrySource: carry.source, holding: last.action !== "publish" };
    } catch {
      return null;
    }
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
    guardianSignal: deskSignal(env.DESK_FEED_PUBLIC_URL),
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
