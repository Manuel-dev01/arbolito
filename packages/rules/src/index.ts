/**
 * Standing rules ("Dejá que Arbolito actúe por vos"): what a rule is, the text the user signs to
 * turn it on, and when it runs. Pure; shared by the Mini App backend (drafts, confirmation) and
 * the runner (apps/agent/src/rules-runner.ts), which executes rules through ArbolitoGuard v2.
 *
 * Two kinds, both spending USDT (what MiniPay users hold):
 * - send:  every month on `dayOfMonth`, pay a saved contact `amountUsdt` worth of `receive`
 *          (a swap first when `receive` isn't USDT; the contact gets exactly what the swap returned).
 * - split: when at least `minIncomingUsdt` arrives in one transfer sent by someone else, change
 *          `percent` of it into `to`.
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

export type RuleKind = "send" | "split";
export type RuleSpec = { kind: "send"; params: SendParams } | { kind: "split"; params: SplitParams };

export function parseRule(kind: string, params: unknown): RuleSpec {
  if (kind === "send") return { kind, params: SendParams.parse(params) };
  if (kind === "split") return { kind, params: SplitParams.parse(params) };
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
