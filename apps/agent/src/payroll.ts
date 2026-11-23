/**
 * Scheduled payroll, in the bot process: on each payday the agent gets a fresh price for every payment
 * on the list, compares it with the last payday's, and tells the payer on Telegram. Ready when the
 * prices are within the schedule's tolerance; held, with the reason, when they aren't.
 *
 * It sends no transaction and holds no key: the payer confirms each payment in MiniPay. Quotes are
 * bound to their payee, so one can't turn into a plain change. A payday runs once (rule_runs is unique
 * per schedule and date), whatever restarts.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import type { Api } from "grammy";
import { erc20Abi, type Address } from "viem";
import { TOKENS } from "@arbolito/config";
import { log } from "@arbolito/chain";
import { claimRun, duePayrolls, finishRun, receiptRowsByTaker, setNextRun, stopRule, users, type RuleRow } from "@arbolito/db";
import { PAYROLL_SYMS, PayrollParams, nextPayday, payrollTrigger, peopleCount, pricesPast, ratesOf, type PayrollFill, type PayrollPayee, type PayrollSym, type PriceMove } from "@arbolito/rules";
import { MiniAppApiError, type MiniAppClient } from "./api";
import type { Lang } from "./i18n";
import { money } from "./money";
import { getServices } from "./services";

/** With the rules runner's, so a tick wakes the database once. */
const TICK_MS = 15 * 60_000;
/** A payday found later than this (the bot was down) is skipped, not announced days late. */
const LATE_MS = 24 * 3_600_000;
const QUOTE_TRIES = 3;

/** A payment made earlier, newest first. */
export interface PastPayment {
  recipient: string;
  fill: PayrollFill;
}

export interface PayrollDeps {
  claim(ruleId: string, trigger: string): Promise<{ id: string } | null>;
  setNext(ruleId: string, at: Date): Promise<void>;
  finish(runId: string, r: { status: "ready" | "held" | "skipped"; note: string | null }): Promise<void>;
  stop(ruleId: string, reason: string): Promise<void>;
  pastPayments(account: string, since: Date): Promise<PastPayment[]>;
  quote: MiniAppClient["quote"];
  usdtBalance(account: string): Promise<bigint>;
  /** False when the payer hasn't linked Telegram (the app's home still shows the payday). */
  tell(account: string, text: string, lang: Lang): Promise<boolean>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type Payday =
  | { status: "ready"; fills: PayrollFill[] }
  | { status: "held"; fills: PayrollFill[]; moves: PriceMove[]; unpriced: PayrollSym[] };

/** Compares with the last payment to one of these payees in each currency; before any, with the signed prices. */
export function baseRates(p: PayrollParams, past: readonly PastPayment[]): Partial<Record<PayrollSym, string>> {
  const base = { ...p.rates };
  for (const sym of PAYROLL_SYMS) {
    const last = past.find((x) => x.fill.to === sym && p.payees.some((y) => y.to === sym && y.address.toLowerCase() === x.recipient.toLowerCase()));
    if (last) base[sym] = ratesOf([last.fill])[sym] ?? base[sym];
  }
  return base;
}

async function priceOne(deps: PayrollDeps, account: string, payee: PayrollPayee): Promise<PayrollFill | null> {
  const size = payee.exact !== undefined ? { amountOut: payee.exact } : { amount: payee.usd! };
  for (let i = 1; i <= QUOTE_TRIES; i++) {
    try {
      const q = await deps.quote({ from: "USDT", to: payee.to, ...size, account, recipient: payee.address });
      return { to: payee.to, amountIn: BigInt(q.amountIn), amountOut: BigInt(q.expectedOut) };
    } catch (e) {
      // No market is an answer; a slow or busy one is worth asking again (quotes are free).
      const slow = !(e instanceof MiniAppApiError) || e.code === "upstream" || e.code === "rate_limited";
      if (!slow || i === QUOTE_TRIES) return null;
      await deps.sleep(i * 5_000);
    }
  }
  return null;
}

/** Prices a payday. One after another: a handful of free quotes, never a burst. */
export async function pricePayday(deps: PayrollDeps, account: string, p: PayrollParams, past: readonly PastPayment[]): Promise<Payday> {
  const fills: PayrollFill[] = [];
  const unpriced = new Set<PayrollSym>();
  for (const payee of p.payees) {
    const f = await priceOne(deps, account, payee);
    if (f) fills.push(f);
    else unpriced.add(payee.to);
  }
  const moves = pricesPast(baseRates(p, past), ratesOf(fills), p.tolerancePct);
  return moves.length || unpriced.size ? { status: "held", fills, moves, unpriced: [...unpriced] } : { status: "ready", fills };
}

const CODE: Record<PayrollSym, string> = { cNGN: "NGN", wARS: "ARS", wBRL: "BRL", wCOP: "COP", wMXN: "MXN" };
const pct = (n: number, lang: Lang) => (lang === "en" ? n.toFixed(2) : n.toFixed(2).replace(".", ","));

/** Language-neutral, for the app's home ("NGN -4.10%" / "ARS ?"). */
export const heldNote = (d: Extract<Payday, { status: "held" }>) => [...d.moves.map((m) => `${CODE[m.sym]} -${m.worsePct.toFixed(2)}%`), ...d.unpriced.map((s) => `${CODE[s]} ?`)].join(", ");

/** What the payer reads on Telegram. No names or addresses: the bot doesn't have them. */
export function paydayText(lang: Lang, p: PayrollParams, d: Payday, usdt: bigint | null): string {
  const T = {
    es: {
      title: `Hoy toca pagar a ${peopleCount(p.payees.length, lang)}.`,
      total: (a: string, b: string) => `${a} por unos ${b}, al precio de ahora.`,
      short: (a: string, b: string) => `Tenés ${a} en USDT: te faltan unos ${b}.`,
      ready: "Está listo en el inicio de Arbolito. No sale nada hasta que confirmes cada pago en MiniPay.",
      held: "Lo frené:",
      moved: (c: string, n: string) => `• ${c}: el precio es ${n}% peor que el del último pago (tu límite es ${p.tolerancePct}%).`,
      none: (c: string) => `• ${c}: ahora no hay precio.`,
      after: "No se movió nada. Podés esperar, o revisarlo en el inicio de Arbolito y pagar igual.",
    },
    pt: {
      title: `Hoje é dia de pagar ${peopleCount(p.payees.length, lang)}.`,
      total: (a: string, b: string) => `${a} por cerca de ${b}, no preço de agora.`,
      short: (a: string, b: string) => `Você tem ${a} em USDT: faltam cerca de ${b}.`,
      ready: "Está pronto no início do Arbolito. Nada sai até você confirmar cada pagamento no MiniPay.",
      held: "Eu segurei:",
      moved: (c: string, n: string) => `• ${c}: o preço está ${n}% pior que o do último pagamento (seu limite é ${p.tolerancePct}%).`,
      none: (c: string) => `• ${c}: não há preço agora.`,
      after: "Nada se moveu. Você pode esperar, ou revisar no início do Arbolito e pagar assim mesmo.",
    },
    en: {
      title: `Today is payday for ${peopleCount(p.payees.length, lang)}.`,
      total: (a: string, b: string) => `${a} for about ${b} at the current price.`,
      short: (a: string, b: string) => `You have ${a} in USDT: about ${b} short.`,
      ready: "It's ready on Arbolito's home screen. Nothing goes out until you confirm each payment in MiniPay.",
      held: "I held it:",
      moved: (c: string, n: string) => `• ${c}: the price is ${n}% worse than the last payday's (your limit is ${p.tolerancePct}%).`,
      none: (c: string) => `• ${c}: no price right now.`,
      after: "Nothing moved. You can wait, or review it on Arbolito's home screen and pay anyway.",
    },
  }[lang];
  const lines = [T.title];
  const cost = d.fills.reduce((n, f) => n + f.amountIn, 0n);
  if (d.fills.length === p.payees.length) {
    const out = PAYROLL_SYMS.map((s) => [s, d.fills.filter((f) => f.to === s).reduce((n, f) => n + f.amountOut, 0n)] as const).filter(([, v]) => v > 0n);
    lines.push(T.total(out.map(([s, v]) => money(s, v, lang)).join(" + "), money("USDT", cost, lang)));
    if (usdt !== null && usdt < cost) lines.push(T.short(money("USDT", usdt, lang), money("USDT", cost - usdt, lang)));
  }
  if (d.status === "ready") lines.push(T.ready);
  else lines.push(T.held, ...d.moves.map((m) => T.moved(CODE[m.sym], pct(m.worsePct, lang))), ...d.unpriced.map((s) => T.none(CODE[s])), T.after);
  return lines.join("\n");
}

const asLang = (l: string): Lang => (l === "pt" || l === "en" ? l : "es");

/** Runs one due payday: claimed and rescheduled first, so nothing can make it run twice. */
export async function runPayday(deps: PayrollDeps, rule: Pick<RuleRow, "id" | "account" | "params" | "lang" | "nextRunAt" | "confirmedAt">): Promise<"ready" | "held" | "skipped" | "already" | "stopped"> {
  const parsed = PayrollParams.safeParse(rule.params);
  if (!parsed.success || !rule.nextRunAt) {
    await deps.stop(rule.id, "The schedule could not be read. Create it again.");
    return "stopped";
  }
  const p = parsed.data;
  const now = deps.now();
  const run = await deps.claim(rule.id, payrollTrigger(rule.nextRunAt));
  await deps.setNext(rule.id, nextPayday(p, new Date(now)));
  if (!run) return "already";
  if (now - rule.nextRunAt.getTime() > LATE_MS) {
    await deps.finish(run.id, { status: "skipped", note: "late" });
    return "skipped";
  }
  const past = await deps.pastPayments(rule.account, rule.confirmedAt ?? new Date(now)).catch(() => []);
  const day = await pricePayday(deps, rule.account, p, past);
  // Recorded before the message: the app shows the payday even if Telegram fails.
  await deps.finish(run.id, { status: day.status, note: day.status === "held" ? heldNote(day) : null });
  const usdt = await deps.usdtBalance(rule.account).catch(() => null);
  const lang = asLang(rule.lang);
  await deps.tell(rule.account, paydayText(lang, p, day, usdt), lang);
  return day.status;
}

/** Starts the runner (no key and no spending, so it is always on); returns its stop function. */
export function startPayrollRunner(api: Api): () => void {
  const s = getServices();
  const OPEN: Record<Lang, string> = { es: "Abrir Arbolito", pt: "Abrir o Arbolito", en: "Open Arbolito" };
  const deps: PayrollDeps = {
    claim: (ruleId, trigger) => claimRun(s.db, ruleId, trigger, null),
    setNext: (id, at) => setNextRun(s.db, id, at),
    finish: (id, r) => finishRun(s.db, id, { status: r.status, txHashes: [], error: r.note }),
    stop: (id, reason) => stopRule(s.db, id, reason),
    async pastPayments(account, since) {
      const rows = await receiptRowsByTaker(s.db, account, since);
      return rows.flatMap((r) => {
        const recipient = (r.bundle as { request?: { recipient?: string } } | null)?.request?.recipient;
        const to = PAYROLL_SYMS.find((x) => TOKENS[x].address.toLowerCase() === r.tokenOut.toLowerCase());
        if (!recipient || !to || r.tokenIn.toLowerCase() !== TOKENS.USDT.address.toLowerCase()) return [];
        return [{ recipient, fill: { to, amountIn: BigInt(r.amountIn), amountOut: BigInt(r.amountOut) } }];
      });
    },
    quote: (r) => s.miniapp.quote(r),
    usdtBalance: (account) => s.chain.readContract({ address: TOKENS.USDT.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [account as Address] }),
    async tell(account, text, lang) {
      const [u] = await s.db
        .select({ telegramId: users.telegramId })
        .from(users)
        .where(and(eq(users.walletAddress, account.toLowerCase()), isNotNull(users.telegramId)))
        .limit(1);
      if (!u?.telegramId) return false;
      const href = s.links?.home();
      await api.sendMessage(Number(u.telegramId), text, { link_preview_options: { is_disabled: true }, ...(href ? { reply_markup: { inline_keyboard: [[{ text: OPEN[lang], url: href }]] } } : {}) });
      return true;
    },
    now: Date.now,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const rule of await duePayrolls(s.db, new Date())) {
        const done = await runPayday(deps, rule).catch((e: unknown) => `failed: ${(e as Error).message}`);
        log(`[payroll] ${rule.id.slice(0, 8)}: ${done}`);
      }
    } catch (e) {
      log(`[payroll] ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);
  return () => clearInterval(timer);
}
