import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import type { z } from "zod";
import { readGuardV2IsContact, readGuardV2Operator, readGuardV2Settings } from "@arbolito/chain";
import { cancelText, describeRule, nextMonthlyRun, parseRule, ruleText, type Lang, type RuleSpec } from "@arbolito/rules";
import type { RuleCancelRequest, RuleCard, RuleConfirmRequest, RulesListResponse } from "../contract";
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

export function toCard(r: RuleRow): z.infer<typeof RuleCard> {
  const spec = parseRule(r.kind, r.params);
  return {
    ruleId: r.id,
    kind: spec.kind,
    status: r.status as "draft" | "active" | "stopped",
    description: describeRule(spec, asLang(r.lang)),
    message: r.message,
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

/** Creates a draft (nothing runs until the account signs it). */
export async function draftRule(deps: MiniappDeps, account: Address, lang: string, spec: RuleSpec): Promise<z.infer<typeof RuleCard>> {
  const acct = account.toLowerCase() as Address;
  await checkAutonomy(deps, acct, spec.kind === "send" ? (spec.params.contact as Address) : undefined);
  const store = deps.store();
  const live = (await store.listRules(acct)).filter((r) => r.status === "active");
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
    runs: runs.map((r) => ({ ruleId: r.ruleId, kind: r.kind as "send" | "split", status: r.status, at: r.createdAt.toISOString(), txHashes: (r.txHashes as string[]) ?? [], error: r.error })),
  };
}
