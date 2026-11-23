/**
 * Scheduled payroll ("every Friday, pay these 5 people"): what a schedule is, the text the payer signs
 * to turn it on, when it falls due, and when a payday is held. Pure; shared by the Mini App (phone and
 * backend) and the bot's payroll runner.
 *
 * A schedule never moves money. On a payday the agent gets a fresh price for every payment and tells
 * the payer; each payment is still confirmed in the payer's own wallet. It carries no names: those
 * stay on the payer's phone.
 */
import { getAddress, type Address } from "viem";
import { z } from "zod";
import type { Lang } from "./index";

export const PAYROLL_SYMS = ["cNGN", "wARS", "wBRL", "wCOP", "wMXN"] as const;
export type PayrollSym = (typeof PAYROLL_SYMS)[number];
/** Currencies an exact amount can be paid in (the Mini App's EXACT_OUT; a test keeps them equal). */
export const PAYROLL_EXACT: readonly PayrollSym[] = ["cNGN", "wCOP"];
export const MAX_PAYROLL_PAYEES = 20;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "0x address");
const usdAmount = z.string().regex(/^\d{1,6}(\.\d{1,2})?$/).refine((v) => Number(v) >= 1, "at least US$ 1");
const localAmount = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).refine((v) => Number(v) > 0, "positive");
const rate = z.string().regex(/^\d{1,12}(\.\d{1,12})?$/).refine((v) => Number(v) > 0, "positive");

/** Pay `usd` dollars' worth of `to`, or exactly `exact` of it. */
const Payee = z.strictObject({ address, to: z.enum(PAYROLL_SYMS), usd: usdAmount.optional(), exact: localAmount.optional() }).superRefine((p, ctx) => {
  if ((p.usd === undefined) === (p.exact === undefined)) ctx.addIssue({ code: "custom", message: "pass usd or exact, not both" });
  if (p.exact !== undefined && !PAYROLL_EXACT.includes(p.to)) ctx.addIssue({ code: "custom", message: `${p.to} can't be paid to the exact amount` });
});
export type PayrollPayee = z.infer<typeof Payee>;

const Every = z.discriminatedUnion("unit", [
  /** 0 = Sunday … 6 = Saturday, in UTC. */
  z.strictObject({ unit: z.literal("week"), weekday: z.number().int().min(0).max(6) }),
  /** 1–28, so every month has the day. */
  z.strictObject({ unit: z.literal("month"), day: z.number().int().min(1).max(28) }),
]);
export type PayrollEvery = z.infer<typeof Every>;

export const PayrollParams = z
  .strictObject({
    payees: z.array(Payee).min(1).max(MAX_PAYROLL_PAYEES),
    every: Every,
    hourUtc: z.number().int().min(0).max(23),
    /** A payday is held when a currency's price is more than this much worse for the payer, percent. */
    tolerancePct: z.number().int().min(1).max(20),
    /** Local currency per dollar when the schedule was signed: the first payday is compared with it. */
    rates: z.partialRecord(z.enum(PAYROLL_SYMS), rate),
  })
  .superRefine((p, ctx) => {
    if (new Set(p.payees.map((x) => x.address.toLowerCase())).size !== p.payees.length) ctx.addIssue({ code: "custom", message: "the same wallet appears twice" });
    for (const x of p.payees) if (!p.rates[x.to]) ctx.addIssue({ code: "custom", message: `no price for ${x.to}` });
  });
export type PayrollParams = z.infer<typeof PayrollParams>;

/** 9 in the morning on the payer's clock, as a UTC hour on the same day. */
export const morningHourUtc = (timezoneOffsetMinutes: number): number => Math.max(0, Math.min(23, Math.round(9 + timezoneOffsetMinutes / 60)));

/** The first payday strictly after `after`. */
export function nextPayday(p: Pick<PayrollParams, "every" | "hourUtc">, after: Date): Date {
  const y = after.getUTCFullYear();
  const m = after.getUTCMonth();
  if (p.every.unit === "month") {
    const a = new Date(Date.UTC(y, m, p.every.day, p.hourUtc));
    return a > after ? a : new Date(Date.UTC(y, m + 1, p.every.day, p.hourUtc));
  }
  const ahead = (p.every.weekday - after.getUTCDay() + 7) % 7;
  const a = new Date(Date.UTC(y, m, after.getUTCDate() + ahead, p.hourUtc));
  return a > after ? a : new Date(Date.UTC(y, m, after.getUTCDate() + ahead + 7, p.hourUtc));
}

/** One payday per schedule per date, ever. */
export const payrollTrigger = (at: Date) => `payroll:${at.toISOString().slice(0, 10)}`;

/** A quoted or made payment: dollars in (6 decimals) and local currency out. */
export interface PayrollFill {
  to: PayrollSym;
  amountIn: bigint;
  amountOut: bigint;
}

const DECIMALS: Record<PayrollSym, number> = { cNGN: 6, wARS: 18, wBRL: 18, wCOP: 18, wMXN: 18 };

/** Local currency per dollar over the payments in each currency, as decimal strings. */
export function ratesOf(fills: readonly PayrollFill[]): Partial<Record<PayrollSym, string>> {
  const out: Partial<Record<PayrollSym, string>> = {};
  for (const sym of PAYROLL_SYMS) {
    const mine = fills.filter((f) => f.to === sym);
    const paid = mine.reduce((n, f) => n + f.amountIn, 0n);
    if (paid <= 0n) continue;
    // Local units per dollar with six decimals, floored.
    const micro = (mine.reduce((n, f) => n + f.amountOut, 0n) * 10n ** 12n) / (paid * 10n ** BigInt(DECIMALS[sym]));
    if (micro > 0n) out[sym] = `${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, "0")}`;
  }
  return out;
}

export interface PriceMove {
  sym: PayrollSym;
  /** How much less local currency a dollar buys, percent (positive = worse for the payer). */
  worsePct: number;
}

/** The currencies whose price is past the tolerance, worst first. A better price never holds a payday. */
export function pricesPast(base: Partial<Record<PayrollSym, string>>, now: Partial<Record<PayrollSym, string>>, tolerancePct: number): PriceMove[] {
  const moves: PriceMove[] = [];
  for (const sym of PAYROLL_SYMS) {
    const b = Number(base[sym]);
    const n = Number(now[sym]);
    if (!(b > 0) || !(n > 0)) continue;
    const worsePct = Math.round((1 - n / b) * 10_000) / 100;
    if (worsePct > tolerancePct) moves.push({ sym, worsePct });
  }
  return moves.sort((a, b) => b.worsePct - a.worsePct);
}

const WEEKDAY: Record<Lang, string[]> = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  pt: ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

/** "Every Friday" / "Every month on day 25". */
export function describeEvery(e: PayrollEvery, lang: Lang): string {
  if (e.unit === "week") {
    const d = WEEKDAY[lang][e.weekday]!;
    // Portuguese weekdays agree: "todo sábado", "toda sexta-feira".
    return lang === "es" ? `Cada ${d}` : lang === "pt" ? `${d.endsWith("feira") ? "Toda" : "Todo"} ${d}` : `Every ${d}`;
  }
  return lang === "es" ? `Cada mes, el día ${e.day}` : lang === "pt" ? `Todo mês, no dia ${e.day}` : `Every month on day ${e.day}`;
}

export const peopleCount = (n: number, lang: Lang) => (lang === "es" ? (n === 1 ? "1 persona" : `${n} personas`) : lang === "pt" ? (n === 1 ? "1 pessoa" : `${n} pessoas`) : n === 1 ? "1 person" : `${n} people`);

/** One line without amounts, names or addresses: lists show it to whoever asks for the account. */
export function describePayroll(p: PayrollParams, lang: Lang): string {
  const n = peopleCount(p.payees.length, lang);
  return lang === "es" ? `${describeEvery(p.every, lang)}: preparar los pagos de ${n}.` : lang === "pt" ? `${describeEvery(p.every, lang)}: preparar os pagamentos de ${n}.` : `${describeEvery(p.every, lang)}: prepare the payments for ${n}.`;
}

const TEXT: Record<Lang, { title: string; account: string; exactly: string; worth: string; hold: (t: number) => string; first: string; bounds: string; id: string }> = {
  es: {
    title: "Arbolito: pagos programados", account: "Cuenta", exactly: "exactamente {a} {s}", worth: "{a} USDT en {s}",
    hold: (t) => `Se frena si el precio es más de ${t}% peor que el del último pago.`, first: "Precio de hoy", id: "ID",
    bounds: "No mueve plata: Arbolito prepara los pagos y vos confirmás cada uno en MiniPay. Podés cancelarlo cuando quieras.",
  },
  pt: {
    title: "Arbolito: pagamentos agendados", account: "Conta", exactly: "exatamente {a} {s}", worth: "{a} USDT em {s}",
    hold: (t) => `Para se o preço estiver mais de ${t}% pior que o do último pagamento.`, first: "Preço de hoje", id: "ID",
    bounds: "Não movimenta dinheiro: o Arbolito prepara os pagamentos e você confirma cada um no MiniPay. Você pode cancelar quando quiser.",
  },
  en: {
    title: "Arbolito: scheduled payments", account: "Account", exactly: "exactly {a} {s}", worth: "{a} USDT in {s}",
    hold: (t) => `Held if the price is more than ${t}% worse than the last payday's.`, first: "Today's price", id: "ID",
    bounds: "It moves no money: Arbolito prepares the payments and you confirm each one in MiniPay. You can cancel it any time.",
  },
};

/** The exact text the payer signs: every payee's full address and amount, the schedule and its id. */
export function payrollText(p: PayrollParams, id: string, account: Address, lang: Lang): string {
  const t = TEXT[lang];
  const syms = PAYROLL_SYMS.filter((s) => p.payees.some((x) => x.to === s));
  return [
    t.title,
    `${t.account}: ${getAddress(account)}`,
    `${describeEvery(p.every, lang)}, ${String(p.hourUtc).padStart(2, "0")}:00 UTC`,
    ...p.payees.map((x, i) => `${i + 1}. ${getAddress(x.address as Address)}: ${(x.exact !== undefined ? t.exactly : t.worth).replace("{a}", x.exact ?? x.usd!).replace("{s}", x.to)}`),
    t.hold(p.tolerancePct),
    `${t.first}: ${syms.map((s) => `1 USDT = ${p.rates[s]} ${s}`).join(", ")}`,
    t.bounds,
    `${t.id}: ${id}`,
  ].join("\n");
}
