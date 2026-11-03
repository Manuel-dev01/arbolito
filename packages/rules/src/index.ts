/**
 * Standing rules ("Dejá que Arbolito actúe por vos"): what a rule is, the text the user signs to
 * turn it on, and when it runs. Pure; shared by the Mini App backend (drafts, confirmation) and
 * the runner (apps/agent/src/rules-runner.ts), which executes rules through ArbolitoGuard v2.
 *
 * Three kinds:
 * - send:     every month on `dayOfMonth`, pay a saved contact `amountUsdt` worth of `receive`
 *             (a swap first when `receive` isn't USDT; the contact gets exactly what the swap returned).
 * - split:    when at least `minIncomingUsdt` arrives in one transfer sent by someone else, change
 *             `percent` of it into `to`.
 * - guardian: keep about `baseDollarPct`% of the account's `sym` + USDT savings in dollars, more
 *             when `sym` is losing value against the dollar and less when it is gaining (the
 *             desk's measured carry), and rebalance when the share drifts past `bandPct` points.
 * The guard bounds every run: per-transaction and daily caps, allowlisted contacts, a TWAP floor.
 */
import { getAddress, type Address } from "viem";
import { z } from "zod";

export const RULE_SYMS = ["wARS", "wBRL", "USDT", "USAT", "USDC"] as const;
export type RuleSym = (typeof RULE_SYMS)[number];
export const SPLIT_TARGETS = ["wARS", "wBRL", "USAT", "USDC"] as const;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "0x address");
const atomic = z.string().regex(/^[1-9]\d*$/, "positive integer (atomic units)");

export const SendParams = z.strictObject({
  contact: address,
  contactName: z.string().trim().min(1).max(40),
  /** USDT spent per run, atomic (6 decimals). */
  amountUsdt: atomic,
  /** What the contact receives. */
  receive: z.enum(RULE_SYMS),
  /** 1–28, so every month has the day. */
  dayOfMonth: z.number().int().min(1).max(28),
});
export type SendParams = z.infer<typeof SendParams>;

export const SplitParams = z.strictObject({
  percent: z.number().int().min(1).max(90),
  to: z.enum(SPLIT_TARGETS),
  /** Smallest incoming USDT transfer that counts as pay, atomic. */
  minIncomingUsdt: atomic,
});
export type SplitParams = z.infer<typeof SplitParams>;

/** Currencies the guardian manages: those with a guard-pinned Uniswap pool against USDT. */
export const GUARDIAN_SYMS = ["wARS", "wBRL"] as const;
export type GuardianSym = (typeof GUARDIAN_SYMS)[number];

export const GuardianParams = z.strictObject({
  sym: z.enum(GUARDIAN_SYMS),
  /** Share of the savings to hold in dollars when the currency is flat against the dollar, percent. */
  baseDollarPct: z.number().int().min(0).max(100),
  /** Rebalance only when the dollar share is further than this from its target, percentage points. */
  bandPct: z.number().int().min(2).max(30),
});
export type GuardianParams = z.infer<typeof GuardianParams>;

export type RuleKind = "send" | "split" | "guardian";
export type RuleSpec = { kind: "send"; params: SendParams } | { kind: "split"; params: SplitParams } | { kind: "guardian"; params: GuardianParams };

export function parseRule(kind: string, params: unknown): RuleSpec {
  if (kind === "send") return { kind, params: SendParams.parse(params) };
  if (kind === "split") return { kind, params: SplitParams.parse(params) };
  if (kind === "guardian") return { kind, params: GuardianParams.parse(params) };
  throw new Error(`unknown rule kind ${kind}`);
}

/** Scheduled runs happen at 13:00 UTC: 10:00 in Buenos Aires and São Paulo. */
export const RUN_HOUR_UTC = 13;

/** The first `dayOfMonth` at RUN_HOUR_UTC strictly after `after`. */
export function nextMonthlyRun(dayOfMonth: number, after: Date): Date {
  const y = after.getUTCFullYear();
  const m = after.getUTCMonth();
  const thisMonth = new Date(Date.UTC(y, m, dayOfMonth, RUN_HOUR_UTC));
  return thisMonth > after ? thisMonth : new Date(Date.UTC(y, m + 1, dayOfMonth, RUN_HOUR_UTC));
}

/** The run key for a scheduled send: one run per rule per month, ever (the runner's idempotency key). */
export const sendTrigger = (runAt: Date) => `send:${runAt.toISOString().slice(0, 7)}`;
/** The run key for a split: one run per incoming transfer (tx hash and log index). */
export const splitTrigger = (txHash: string, logIndex: number) => `split:${txHash.toLowerCase()}:${logIndex}`;
/** The run key for a guardian move: at most one per rule, direction and UTC day. */
export const guardianTrigger = (at: Date, action: "protect" | "reenter") => `guardian:${action}:${at.toISOString().slice(0, 10)}`;

// ── Guardian decisions (pure) ──────────────────────────────────────────────────

/** Points of dollar share added per bps/day the currency loses against the dollar (about +2 points per 0.3% a month). */
export const GUARDIAN_TILT_PP_PER_BPS_DAY = 2;
/** The carry moves the target at most this far from the user's base, percentage points. */
export const GUARDIAN_MAX_TILT_PP = 20;
/** Savings below this (micro-USD) aren't managed; moves below this aren't made. */
export const GUARDIAN_MIN_SAVINGS_MICROS = 2_000_000n;
export const GUARDIAN_MIN_MOVE_MICROS = 500_000n;

/** What the guardian reads from Arbolito Desk's feed for one currency. */
export interface GuardianSignal {
  /** Local currency per US$ (the desk's fair value). */
  fiatPerUsd: number;
  /** Depreciation against the dollar, bps per day (positive = losing value), measured over the last week. */
  carryBpsPerDay: number;
  carrySource: "measured" | "prior";
  /** The desk's breaker is holding this currency: its price sources disagree. */
  holding: boolean;
}

/** The dollar share to aim for, percent: the base tilted by the carry, clamped to 20 points either way and to 0–100. */
export function guardianTargetPct(baseDollarPct: number, carryBpsPerDay: number): number {
  const tilt = Math.max(-GUARDIAN_MAX_TILT_PP, Math.min(GUARDIAN_MAX_TILT_PP, carryBpsPerDay * GUARDIAN_TILT_PP_PER_BPS_DAY));
  return Math.round(Math.max(0, Math.min(100, baseDollarPct + tilt)) * 10) / 10;
}

export type GuardianDecision =
  | { action: "hold"; reason: string; targetPct?: number; actualPct?: number }
  | {
      /** protect sells `sym` for USDT; reenter sells USDT for `sym`. */
      action: "protect" | "reenter";
      /** Atomic units of the token sold. */
      amountIn: bigint;
      usdMicros: bigint;
      targetPct: number;
      actualPct: number;
      reason: string;
    };

/** wFIAT (18 decimals) to micro-USD at `fiatPerUsd`. */
export function wfiatToUsdMicros(amount: bigint, fiatPerUsd: number): bigint {
  const rateMicro = BigInt(Math.round(fiatPerUsd * 1e6));
  return rateMicro > 0n ? (amount * 1_000_000n) / rateMicro / 10n ** 12n : 0n;
}

/** micro-USD to wFIAT (18 decimals) at `fiatPerUsd`. */
export function usdMicrosToWfiat(usdMicros: bigint, fiatPerUsd: number): bigint {
  return usdMicros * BigInt(Math.round(fiatPerUsd * 1e6)) * 10n ** 6n;
}

const monthly = (bpsPerDay: number) => ((Math.abs(bpsPerDay) * 30) / 100).toFixed(1);

/**
 * Where the account's `sym` + USDT savings should be, and the move that gets them there. Holds when
 * the desk's sources disagree, when the savings are too small, or when the share is inside the band.
 */
export function decideGuardian(p: GuardianParams, s: GuardianSignal, bal: { wfiat: bigint; usdt: bigint }): GuardianDecision {
  if (s.holding) return { action: "hold", reason: "price sources disagree right now (the desk's breaker is on)" };
  if (!(s.fiatPerUsd > 0)) return { action: "hold", reason: "no fair price" };
  const total = wfiatToUsdMicros(bal.wfiat, s.fiatPerUsd) + bal.usdt;
  if (total < GUARDIAN_MIN_SAVINGS_MICROS) return { action: "hold", reason: "savings too small to manage" };
  const targetPct = guardianTargetPct(p.baseDollarPct, s.carryBpsPerDay);
  const actualBps = (bal.usdt * 10_000n) / total;
  const targetBps = BigInt(Math.round(targetPct * 100));
  const actualPct = Number(actualBps) / 100;
  const band = BigInt(p.bandPct * 100);
  const trend =
    s.carryBpsPerDay > 0
      ? `${p.sym} is losing ${monthly(s.carryBpsPerDay)}% a month against the dollar`
      : s.carryBpsPerDay < 0
        ? `${p.sym} is gaining ${monthly(s.carryBpsPerDay)}% a month against the dollar`
        : `${p.sym} is flat against the dollar`;
  const basis = s.carrySource === "measured" ? "measured over the last week" : "assumed, not enough history yet";
  const reason = `${trend} (${basis}), so the target is ${targetPct}% in dollars; you held ${actualPct}%.`;
  const move = (diffBps: bigint) => (diffBps * total) / 10_000n;
  if (actualBps + band < targetBps) {
    const usdMicros = move(targetBps - actualBps);
    if (usdMicros < GUARDIAN_MIN_MOVE_MICROS) return { action: "hold", reason: "move too small", targetPct, actualPct };
    return { action: "protect", amountIn: usdMicrosToWfiat(usdMicros, s.fiatPerUsd), usdMicros, targetPct, actualPct, reason };
  }
  if (actualBps > targetBps + band) {
    const usdMicros = move(actualBps - targetBps);
    if (usdMicros < GUARDIAN_MIN_MOVE_MICROS) return { action: "hold", reason: "move too small", targetPct, actualPct };
    return { action: "reenter", amountIn: usdMicros, usdMicros, targetPct, actualPct, reason };
  }
  return { action: "hold", reason: `inside the band (${actualPct}% in dollars, target ${targetPct}% within ${p.bandPct} points)`, targetPct, actualPct };
}

export type Lang = "es" | "pt" | "en";

const NAME: Record<Lang, Record<RuleSym, string>> = {
  es: { wARS: "pesos (wARS)", wBRL: "reales (wBRL)", USDT: "dólares (USDT)", USAT: "dólares (USA₮)", USDC: "dólares (USDC)" },
  pt: { wARS: "pesos (wARS)", wBRL: "reais (wBRL)", USDT: "dólares (USDT)", USAT: "dólares (USA₮)", USDC: "dólares (USDC)" },
  en: { wARS: "pesos (wARS)", wBRL: "reais (wBRL)", USDT: "dollars (USDT)", USAT: "dollars (USA₮)", USDC: "dollars (USDC)" },
};

/** "US$ 50,00" / "US$ 50.00" from USDT atomic units (6 decimals). */
export function usd(atomicUsdt: string | bigint, lang: Lang): string {
  const v = BigInt(atomicUsdt);
  const cents = (v + 5_000n) / 10_000n;
  const int = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, lang === "en" ? "," : ".");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `US$ ${int}${lang === "en" ? "." : ","}${frac}`;
}

/** One line describing the rule, in the user's language (shown on cards and in lists). */
export function describeRule(r: RuleSpec, lang: Lang): string {
  if (r.kind === "guardian") {
    const p = r.params;
    const cur = NAME[lang][p.sym];
    if (lang === "es") return `Guardián de tus ${cur}: mantener cerca del ${p.baseDollarPct}% de tus ahorros en dólares (más si se devalúan, menos si se aprecian) y reequilibrar cuando se desvíe más de ${p.bandPct} puntos.`;
    if (lang === "pt") return `Guardião dos seus ${cur}: manter perto de ${p.baseDollarPct}% das suas economias em dólares (mais se desvalorizarem, menos se valorizarem) e reequilibrar quando desviar mais de ${p.bandPct} pontos.`;
    return `Guardian of your ${cur}: keep about ${p.baseDollarPct}% of your savings in dollars (more when they lose value, less when they gain) and rebalance when it drifts more than ${p.bandPct} points.`;
  }
  if (r.kind === "send") {
    const p = r.params;
    const what = NAME[lang][p.receive];
    if (lang === "es") return `Cada mes, el día ${p.dayOfMonth}: enviar ${usd(p.amountUsdt, lang)} a ${p.contactName}, que recibe ${what}.`;
    if (lang === "pt") return `Todo mês, no dia ${p.dayOfMonth}: enviar ${usd(p.amountUsdt, lang)} para ${p.contactName}, que recebe ${what}.`;
    return `Every month on day ${p.dayOfMonth}: send ${usd(p.amountUsdt, lang)} to ${p.contactName}, who receives ${what}.`;
  }
  const p = r.params;
  const to = NAME[lang][p.to];
  if (lang === "es") return `Cuando te lleguen al menos ${usd(p.minIncomingUsdt, lang)}, pasar el ${p.percent}% a ${to}.`;
  if (lang === "pt") return `Quando chegarem pelo menos ${usd(p.minIncomingUsdt, lang)}, trocar ${p.percent}% por ${to}.`;
  return `When at least ${usd(p.minIncomingUsdt, lang)} arrives, change ${p.percent}% into ${to}.`;
}

const HEAD: Record<Lang, { title: string; account: string; to: string; bounds: string; id: string }> = {
  es: { title: "Arbolito: regla automática", account: "Cuenta", to: "Destino", bounds: "Se ejecuta con tu permiso de ArbolitoGuard y dentro de tus límites. Podés cancelarla cuando quieras.", id: "ID" },
  pt: { title: "Arbolito: regra automática", account: "Conta", to: "Destino", bounds: "Roda com a sua permissão no ArbolitoGuard e dentro dos seus limites. Você pode cancelar quando quiser.", id: "ID" },
  en: { title: "Arbolito: automatic rule", account: "Account", to: "To", bounds: "It runs under your ArbolitoGuard permission and within your limits. You can cancel it any time.", id: "ID" },
};

/**
 * The exact text the user signs (personal_sign) to turn a rule on. It names the account, the
 * full contact address and the rule id, so a signature can't be replayed onto another rule.
 */
export function ruleText(r: RuleSpec, ruleId: string, account: Address, lang: Lang): string {
  const h = HEAD[lang];
  const lines = [h.title, `${h.account}: ${getAddress(account)}`, describeRule(r, lang)];
  if (r.kind === "send") lines.push(`${h.to}: ${getAddress(r.params.contact as Address)}`);
  lines.push(h.bounds, `${h.id}: ${ruleId}`);
  return lines.join("\n");
}

/**
 * The text the user signs to pause or resume Arbolito's rules. `at` (ISO time) makes each one
 * single-use: the server takes it only if it's recent and newer than the last one stored.
 */
export function pauseText(account: Address, paused: boolean, at: string): string {
  return `Arbolito: ${paused ? "pause" : "resume"} automatic rules
Account: ${getAddress(account)}
At: ${at}`;
}

/** The text the user signs to cancel a rule. */
export function cancelText(ruleId: string, account: Address): string {
  return `Arbolito: cancel rule\nAccount: ${getAddress(account)}\nID: ${ruleId}`;
}
