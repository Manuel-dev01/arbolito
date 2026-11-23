import { randomUUID } from "node:crypto";
import { formatUnits, type Address, type Hex } from "viem";
import type { z } from "zod";
import { TOKENS } from "@arbolito/config";
import { readGuardV2Budget, readGuardV2IsContact, readGuardV2Operator, readGuardV2Settings } from "@arbolito/chain";
import { cancelText, describeRule, nextMonthlyRun, nextPayday, parseRule, payrollText, ruleText, type Lang, type RuleSpec } from "@arbolito/rules";
import type { PayrollCreateRequest, RuleCancelRequest, RuleCard, RuleConfirmRequest, RulesListResponse } from "../contract";
import type { MiniappDeps } from "./deps";
import { badRequest, notReady } from "./errors";
import { signedBy } from "./signature";
import type { RuleRow } from "./store";

/**
 * Standing rules for the Mini App. The chat drafts a rule; the account turns it on by signing the
 * rule's exact text in MiniPay (personal_sign), so nobody else can create rules for a wallet. The
 * runner (packages/rules/src/runner.ts, in the bot service) executes active rules through
 * ArbolitoGuard, which bounds every run onchain.
 */

const LANGS = ["es", "pt", "en"] as const;
const asLang = (l: string): Lang => ((LANGS as readonly string[]).includes(l) ? (l as Lang) : "es");
const MAX_ACTIVE_RULES = 10;
const MAX_PAYROLLS = 5;

export function toCard(r: RuleRow): z.infer<typeof RuleCard> {
  const spec = parseRule(r.kind, r.params);
  return {
    ruleId: r.id,
    kind: spec.kind,
    status: r.status as "draft" | "active" | "stopped",
    description: describeRule(spec, asLang(r.lang)),
    // GET /rules is open to anyone who knows the account: who a payroll pays, and how much, isn't in it.
    message: spec.kind === "payroll" ? "" : r.message,
    nextRunAt: r.nextRunAt?.toISOString() ?? null,
    stoppedReason: r.stoppedReason,
  };
}

/** The account must have autonomy on (guard configured, Arbolito's operator active) before any rule. */
async function checkAutonomy(deps: MiniappDeps, account: Address, contact?: Address) {
  if (!deps.guard) throw notReady("Automatic rules aren't available yet.");
  const [settings, op] = await Promise.all([readGuardV2Settings(deps.chain, deps.guard.address, account), readGuardV2Operator(deps.chain, deps.guard.address, account)]);
  if (!settings.configured || !op.active || op.operator.toLowerCase() !== deps.guard.operator.toLowerCase()) {
    throw badRequest("Turn on “Let Arbolito act for you” first (Settings → Limits & security).");
  }
  if (contact && !(await readGuardV2IsContact(deps.chain, deps.guard.address, account, contact))) {
    throw badRequest("That contact isn't one Arbolito may pay. Add them when you turn on “Let Arbolito act for you”.");
  }
}

/**
 * A monthly send runs in pieces no bigger than the per-transaction limit, so it may be above that
 * limit; but it all runs on one day, so it can't be above the daily limit (it could never finish).
 */
async function checkSendFitsLimits(deps: MiniappDeps, account: Address, amountUsdt: bigint) {
  if (!deps.guard) return;
  const budget = await readGuardV2Budget(deps.chain, deps.guard.address, account, TOKENS.USDT.address as Address);
  if (budget.maxPerDay > 0n && amountUsdt > budget.maxPerDay) {
    throw badRequest(
      `US$ ${formatUnits(amountUsdt, 6)} a month is above your daily limit of US$ ${formatUnits(budget.maxPerDay, 6)}, so it could never run in full. Lower the amount, or raise the daily limit in Settings → Limits & security.`,
    );
  }
}

/**
 * A guardian moves the currency both ways through the guard, so the account needs a limit for it
 * (and for USDT): without one the guard would refuse every move.
 */
async function checkGuardianLimits(deps: MiniappDeps, account: Address, sym: "wARS" | "wBRL") {
  if (!deps.guard) return;
  const [fiat, usdt] = await Promise.all([
    readGuardV2Budget(deps.chain, deps.guard.address, account, TOKENS[sym].address as Address),
    readGuardV2Budget(deps.chain, deps.guard.address, account, TOKENS.USDT.address as Address),
  ]);
  if (fiat.maxPerTx === 0n || usdt.maxPerTx === 0n) {
    throw badRequest(`The guardian moves ${sym} and dollars for you, so both need a limit. Turn on “Let Arbolito act for you” again with limits in ${sym === "wARS" ? "pesos" : "reais"} and dollars.`);
  }
}

/** Creates a draft (nothing runs until the account signs it). */
export async function draftRule(deps: MiniappDeps, account: Address, lang: string, spec: RuleSpec): Promise<z.infer<typeof RuleCard>> {
  const acct = account.toLowerCase() as Address;
  await checkAutonomy(deps, acct, spec.kind === "send" ? (spec.params.contact as Address) : undefined);
  if (spec.kind === "send") await checkSendFitsLimits(deps, acct, BigInt(spec.params.amountUsdt));
  if (spec.kind === "guardian") await checkGuardianLimits(deps, acct, spec.params.sym);
  const store = deps.store();
  const live = (await store.listRules(acct)).filter((r) => r.status === "active" && r.kind !== "payroll");
  if (live.length >= MAX_ACTIVE_RULES) throw badRequest(`You already have ${MAX_ACTIVE_RULES} rules on. Cancel one first.`);
  const id = randomUUID();
  const l = asLang(lang);
  const row = await store.insertRuleDraft({ id, account: acct, kind: spec.kind, params: spec.params, lang: l, message: ruleText(spec, id, acct, l) });
  return toCard(row);
}

/** POST /rules/confirm: the account's signature over the draft's text turns it on. */
export async function confirmRule(deps: MiniappDeps, req: z.infer<typeof RuleConfirmRequest>): Promise<{ rule: z.infer<typeof RuleCard> }> {
  const store = deps.store();
  const row = await store.getRule(req.ruleId);
  if (!row || row.account !== req.account.toLowerCase()) throw badRequest("Rule not found.", 404);
  if (row.status !== "draft") throw badRequest("This rule was already confirmed or cancelled.", 409);
  if (!(await signedBy(deps, req.account as Address, row.message, req.signature as Hex))) throw badRequest("The signature doesn't match this rule.");
  const spec = parseRule(row.kind, row.params);
  // Autonomy may have been revoked since the draft: check again before turning it on.
  await checkAutonomy(deps, row.account as Address, spec.kind === "send" ? (spec.params.contact as Address) : undefined);
  const now = new Date(deps.now());
  const nextRunAt = spec.kind === "send" ? nextMonthlyRun(spec.params.dayOfMonth, now) : null;
  if (!(await store.activateRule(row.id, { signature: req.signature, nextRunAt, cursorBlock: null, now }))) throw badRequest("This rule was already confirmed or cancelled.", 409);
  return { rule: toCard((await store.getRule(row.id))!) };
}

/** POST /payroll: a schedule, stored only with the account's signature over its exact text. Its id is single-use. */
export async function createPayroll(deps: MiniappDeps, req: z.infer<typeof PayrollCreateRequest>): Promise<{ rule: z.infer<typeof RuleCard> }> {
  const acct = req.account.toLowerCase() as Address;
  if (req.params.payees.some((p) => p.address.toLowerCase() === acct)) throw badRequest("A schedule can't pay the wallet that signs it.");
  const message = payrollText(req.params, req.id, acct, req.lang);
  if (!(await signedBy(deps, acct, message, req.signature as Hex))) throw badRequest("The signature doesn't match this schedule.");
  const now = new Date(deps.now());
  return deps.store().transaction(async (store) => {
    if (await store.getRule(req.id)) throw badRequest("This schedule already exists.", 409);
    const live = (await store.listRules(acct)).filter((r) => r.status === "active" && r.kind === "payroll");
    if (live.length >= MAX_PAYROLLS) throw badRequest(`You already have ${MAX_PAYROLLS} schedules on. Cancel one first.`);
    await store.insertRuleDraft({ id: req.id, account: acct, kind: "payroll", params: req.params, lang: req.lang, message });
    await store.activateRule(req.id, { signature: req.signature, nextRunAt: nextPayday(req.params, now), cursorBlock: null, now });
    return { rule: toCard((await store.getRule(req.id))!) };
  });
}

/** POST /rules/cancel: the account's signature over cancelText. */
export async function cancelRuleReq(deps: MiniappDeps, req: z.infer<typeof RuleCancelRequest>): Promise<{ rule: z.infer<typeof RuleCard> }> {
  const store = deps.store();
  const row = await store.getRule(req.ruleId);
  if (!row || row.account !== req.account.toLowerCase()) throw badRequest("Rule not found.", 404);
  if (!(await signedBy(deps, req.account as Address, cancelText(row.id, req.account as Address), req.signature as Hex))) throw badRequest("The signature doesn't match.");
  if (!(await store.cancelRule(row.id))) throw badRequest("This rule was already cancelled.", 409);
  const card = toCard(row);
  return { rule: { ...card, status: "stopped", nextRunAt: null } };
}

/** GET /rules?account=: the account's rules and their latest runs. */
export async function listRulesRes(deps: MiniappDeps, account: Address): Promise<z.infer<typeof RulesListResponse>> {
  const store = deps.store();
  const [rows, runs] = await Promise.all([store.listRules(account.toLowerCase()), store.ruleRuns(account.toLowerCase(), 20)]);
  return {
    rules: rows.map(toCard),
    runs: runs.map((r) => ({ ruleId: r.ruleId, kind: r.kind as RuleSpec["kind"], status: r.status, at: r.createdAt.toISOString(), txHashes: (r.txHashes as string[]) ?? [], error: r.error })),
  };
}
