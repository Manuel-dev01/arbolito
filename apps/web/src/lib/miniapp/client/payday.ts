/**
 * Scheduled payroll on the phone. The server knows a schedule's wallets and amounts (to price each
 * payday) but no names, and never gives the list back: this phone keeps its own copy.
 *
 * Money-safety rule encoded here: a payday never offers a payment that already went out. Two records
 * are used, and either one is enough: this phone's payout runs, and the wallet's receipts on the server.
 */
import { pricesPast, ratesOf, type PayrollEvery, type PayrollFill, type PayrollParams, type PayrollPayee, type PayrollSym, type PriceMove } from "@arbolito/rules";
import type { RulesList } from "./api";
import { DECIMALS, parseHuman } from "./format";
import type { PayoutItem, PayoutRun } from "./payout";

export interface ScheduleItem {
  contactId: string;
  name: string;
  address: string;
  to: PayrollSym;
  /** Dollars to spend, or exactly how much must arrive (human units, as typed). */
  amount?: string;
  exact?: string;
}

export interface Schedule {
  ruleId: string;
  items: ScheduleItem[];
  every: PayrollEvery;
  hourUtc: number;
  tolerancePct: number;
  /** Local currency per dollar at the last payday made on this phone (at first, when it was signed). */
  rates: Partial<Record<PayrollSym, string>>;
  /** The payday (its run time) whose payments this phone started: wallets that were paid or may have been. */
  paid?: { at: string; to: string[] };
  /** The last payday finished or skipped here. */
  doneAt?: string;
}

/** A payday stays on the home screen this long. */
export const PAYDAY_SHOWN_MS = 3 * 86_400_000;

export interface Due {
  schedule: Schedule;
  at: string;
  held: boolean;
  /** Why it was held ("NGN -4.10%"), as the agent recorded it. */
  note: string | null;
}

const OPEN = ["ready", "held", "running"];

/** The paydays waiting for the payer: the newest of each schedule that is still on, not finished or skipped here. */
export function duePaydays(schedules: readonly Schedule[], list: RulesList, now: number): Due[] {
  return schedules.flatMap((schedule): Due[] => {
    if (!list.rules.some((r) => r.ruleId === schedule.ruleId && r.kind === "payroll" && r.status === "active")) return [];
    const run = list.runs.filter((r) => r.ruleId === schedule.ruleId && r.kind === "payroll" && OPEN.includes(r.status)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    if (!run || now - Date.parse(run.at) > PAYDAY_SHOWN_MS) return [];
    if (schedule.doneAt && Date.parse(schedule.doneAt) >= Date.parse(run.at)) return [];
    return [{ schedule, at: run.at, held: run.status === "held", note: run.error }];
  });
}

export interface PaidReceipt {
  kind: "change" | "send";
  recipient: string | null;
  at: string;
  to: string;
}

/** Who is still to be paid this payday. Anything that may already have gone out is left out. */
export function leftToPay(due: Due, receipts: readonly PaidReceipt[]): ScheduleItem[] {
  const here = new Set(due.schedule.paid?.at === due.at ? due.schedule.paid.to.map((a) => a.toLowerCase()) : []);
  return due.schedule.items.filter((i) => {
    const wallet = i.address.toLowerCase();
    if (here.has(wallet)) return false;
    return !receipts.some((r) => r.kind === "send" && r.recipient?.toLowerCase() === wallet && r.to === i.to && Date.parse(r.at) >= Date.parse(due.at));
  });
}

/** The wallets of a payday's run that were paid, or may have been. */
export const maybePaid = (run: PayoutRun): string[] => run.items.filter((i) => i.state === "paid" || i.state === "sending" || i.state === "unknown").map((i) => i.address);

/** Reviewed or made payments as fills, for prices. */
export const fillsOf = (items: readonly PayoutItem[]): PayrollFill[] =>
  items.map((i) => ({ to: i.to as PayrollSym, amountIn: i.paidIn ? BigInt(i.paidIn) : parseHuman(i.amount, DECIMALS[i.from]), amountOut: BigInt(i.paidOut ?? i.reviewedOut) }));

/** What moved past the schedule's tolerance between the last payday and this review. */
export const reviewMoves = (s: Pick<Schedule, "rates" | "tolerancePct">, items: readonly PayoutItem[]): PriceMove[] => pricesPast(s.rates, ratesOf(fillsOf(items)), s.tolerancePct);

/** The schedule's next baseline: the prices just paid, keeping the old one for a currency not paid. */
export const paidRates = (s: Pick<Schedule, "rates">, run: PayoutRun): Schedule["rates"] => ({ ...s.rates, ...ratesOf(fillsOf(run.items.filter((i) => i.state === "paid"))) });

/** A payout's items as a schedule's (the amounts as they were typed, not today's cost of an exact one). */
export const scheduleItems = (items: readonly PayoutItem[]): ScheduleItem[] =>
  items.map((i) => ({ contactId: i.contactId, name: i.name, address: i.address, to: i.to as PayrollSym, ...(i.exact !== undefined ? { exact: i.exact } : { amount: i.amount }) }));

/** What gets signed and stored on the server: wallets, amounts and prices, no names. */
export function payrollParams(s: Omit<Schedule, "ruleId">): PayrollParams {
  const payees = s.items.map((i): PayrollPayee => ({ address: i.address.toLowerCase(), to: i.to, ...(i.exact !== undefined ? { exact: i.exact } : { usd: i.amount! }) }));
  return { payees, every: s.every, hourUtc: s.hourUtc, tolerancePct: s.tolerancePct, rates: s.rates };
}
