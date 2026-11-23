"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, type Address } from "viem";
import { EXACT_OUT } from "../../lib/miniapp/contract";
import type { ApiClient, Quote } from "../../lib/miniapp/client/api";
import type { ClientErrorCode } from "../../lib/miniapp/client/errors";
import type { ExecStage } from "../../lib/miniapp/client/execute";
import { DECIMALS, SYM_OF, type Lang } from "../../lib/miniapp/client/format";
import { MAX_PAYEES, restoreRun, runFinished, runPayout, settleReceipts, type PayoutDeps, type PayoutItem, type PayoutRun } from "../../lib/miniapp/client/payout";
import { newId, type Contact, type ReceiptIndexEntry, type Store } from "../../lib/miniapp/client/store";
import { maybePaid, paidRates, reviewMoves, type Schedule, type ScheduleItem } from "../../lib/miniapp/client/payday";
import type { Wallet } from "../../lib/miniapp/client/wallet";
import type { PriceMove } from "@arbolito/rules";
import type { Screen } from "./screens";

/** Payouts are paid in dollars (USDT), in a currency with a market of its own: one dollar is Textile's minimum. */
export const PAY_SYM = "USDT" as const;
export const MIN_USD = 1;

/** Who can be in a payout: saved with a wallet, and receiving local currency (a dollar send has no conversion to prove). */
export const payable = (c: Contact) => !!c.address && c.cur !== "USD";

const AMOUNT = /^\d{1,6}(\.\d{1,2})?$/;
/** A typed amount as the API takes it, or null while it can't be paid. */
export function payoutAmount(typed: string | undefined): string | null {
  const v = (typed ?? "").trim().replace(",", ".").replace(/\.$/, "");
  return AMOUNT.test(v) && Number(v) >= MIN_USD ? v : null;
}

/** Currencies a payee can be paid in to the exact amount ("₦75,000"). */
export const canExact = (c: Contact) => EXACT_OUT.includes(SYM_OF[c.cur]);

const EXACT = /^\d{1,9}(\.\d{1,2})?$/;
/** A typed local amount as the API takes it, or null. The US$ 1 minimum is checked with the price. */
export function exactAmount(typed: string | undefined): string | null {
  const v = (typed ?? "").trim().replace(",", ".").replace(/\.$/, "");
  return EXACT.test(v) && Number(v) > 0 ? v : null;
}

export interface PayoutCtx {
  /** Contacts whose amount is typed in their own currency and must arrive exactly. */
  exact: Record<string, boolean>;
  setExact(contactId: string, on: boolean): void;
  amounts: Record<string, string>;
  setAmount(contactId: string, typed: string): void;
  review: PayoutItem[] | null;
  reviewing: boolean;
  run: PayoutRun | null;
  running: boolean;
  /** The payment in progress and where its confirmations are. */
  stage: { index: number; stage: ExecStage } | null;
  requestReview(): void;
  /** Set while reviewing a payday: the currencies whose price moved past the schedule's tolerance. */
  reviewMoves: PriceMove[] | null;
  /** Prices the payments left of a payday and opens the review. */
  startPayday(payday: NonNullable<PayoutRun["payday"]>, schedule: Schedule, left: ScheduleItem[]): Promise<void>;
  confirm(): void;
  /** Picks up the payments that are still open. */
  resume(): void;
  /** Takes the new, lower price of a held payment; it is paid on the next resume. */
  acceptHeld(index: number): void;
  /** The payer checked what happened to an unknown payment. */
  resolveUnknown(index: number, was: "paid" | "not-sent"): void;
  /** Forgets a run that isn't in progress. */
  clear(): void;
}

type Target = { contactId: string; name: string; address: string; to: PayoutItem["to"] } & ({ amount: string; exact?: undefined } | { exact: string });

interface Ready {
  account: Address;
  api: ApiClient;
  wallet: Wallet;
  store: Store;
}

export function usePayout(
  ready: Ready | null,
  o: { contacts: Contact[]; lang: Lang; go(s: Screen, o?: { replace?: boolean }): void; showError(c: ClientErrorCode): void; refreshBalances(): void; addReceipt(e: ReceiptIndexEntry): void; sheetAmount(s: string): void },
): PayoutCtx {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [exact, setExactState] = useState<Record<string, boolean>>({});
  const [review, setReview] = useState<PayoutItem[] | null>(null);
  const [reviewing, setReviewing] = useState(false);
  /** The payday under review: any change to the list drops it with the review. */
  const [payday, setPayday] = useState<{ of: NonNullable<PayoutRun["payday"]>; moves: PriceMove[] } | null>(null);
  const [run, setRunState] = useState<PayoutRun | null>(null);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<PayoutCtx["stage"]>(null);
  /** Set synchronously: two taps must never start two runs. */
  const busy = useRef(false);
  const latest = useRef(o);
  latest.current = o;

  const save = useCallback(
    (r: PayoutRun) => {
      ready?.store.setPayoutRun(ready.account, r);
      // Kept with the schedule too: closing this run must not offer its payments again.
      if (ready && r.payday) ready.store.patchSchedule(ready.account, r.payday.ruleId, { paid: { at: r.payday.at, to: [...new Set([...r.payday.before, ...maybePaid(r)])] } });
      setRunState(r);
    },
    [ready],
  );

  const deps = useCallback((): PayoutDeps | null => {
    if (!ready) return null;
    const known = new Set(ready.store.receipts(ready.account).map((r) => r.receiptId));
    return {
      api: ready.api,
      wallet: ready.wallet,
      lang: latest.current.lang,
      save: (r) => {
        save(r);
        for (const i of r.items) {
          if (!i.receiptId || known.has(i.receiptId)) continue;
          known.add(i.receiptId);
          latest.current.addReceipt({ receiptId: i.receiptId, kind: "send", to: i.name, at: new Date().toISOString() });
        }
      },
      onStage: (index, s) => setStage({ index, stage: s }),
    };
  }, [ready, save]);

  // A run left open on this phone: anything mid-flight becomes "unknown", then its receipts are looked up.
  useEffect(() => {
    const saved = ready?.store.payoutRun(ready.account);
    const d = deps();
    if (!ready || !saved || !d || busy.current) return;
    const r = restoreRun(saved);
    save(r);
    busy.current = true;
    void settleReceipts(d, r).finally(() => {
      busy.current = false;
    });
  }, [ready, deps, save]);

  const setAmount = useCallback((id: string, typed: string) => {
    setAmounts((a) => ({ ...a, [id]: typed }));
    setReview(null);
    setPayday(null);
  }, []);

  const setExact = useCallback((id: string, on: boolean) => {
    setExactState((e) => ({ ...e, [id]: on }));
    // The number meant something else in the other currency.
    setAmounts((a) => ({ ...a, [id]: "" }));
    setReview(null);
    setPayday(null);
  }, []);

  /** Prices every payment; shows the error and returns null if one can't be priced. */
  const price = useCallback(async (picked: Target[]): Promise<PayoutItem[] | null> => {
    if (!ready || reviewing || !picked.length) return null;
    setReviewing(true);
    const items: PayoutItem[] = [];
    try {
      // Three at a time: each is a live quote across venues.
      for (let i = 0; i < picked.length; i += 3) {
        const part = picked.slice(i, i + 3);
        const quotes: Quote[] = await Promise.all(
          part.map((c) => {
            const size = c.exact !== undefined ? { amountOut: c.exact } : { amount: c.amount };
            const ask = () => ready.api.quote({ from: PAY_SYM, to: c.to, ...size, account: ready.account, recipient: c.address as Address, lang: latest.current.lang });
            // A quote is free and moves nothing: one slow market shouldn't cost the whole review.
            return ask().catch((e: { code?: ClientErrorCode }) => (e.code === "upstream" || e.code === "network" ? ask() : Promise.reject(e)));
          }),
        );
        part.forEach((c, n) =>
          items.push({
            contactId: c.contactId,
            name: c.name,
            address: c.address,
            from: PAY_SYM,
            to: c.to,
            ...(c.exact !== undefined ? { exact: c.exact, amount: formatUnits(BigInt(quotes[n]!.amountIn), DECIMALS[PAY_SYM]) } : { amount: c.amount }),
            reviewedOut: quotes[n]!.expectedOut,
            venues: quotes[n]!.venues,
            state: "todo",
          }),
        );
      }
      // Same currency together, so one approval serves them all.
      items.sort((a, b) => a.to.localeCompare(b.to));
      return items;
    } catch (e) {
      latest.current.showError((e as { code?: ClientErrorCode }).code ?? "network");
      return null;
    } finally {
      setReviewing(false);
    }
  }, [ready, reviewing]);

  const requestReview = useCallback(async () => {
    const picked = latest.current.contacts.flatMap((c): Target[] => {
      if (!payable(c)) return [];
      const base = { contactId: c.id, name: c.name, address: c.address!, to: SYM_OF[c.cur] };
      const out = exact[c.id] ? exactAmount(amounts[c.id]) : null;
      const usd = exact[c.id] ? null : payoutAmount(amounts[c.id]);
      return out ? [{ ...base, exact: out }] : usd ? [{ ...base, amount: usd }] : [];
    });
    const items = await price(picked.slice(0, MAX_PAYEES));
    if (!items) return;
    setPayday(null);
    setReview(items);
    latest.current.go("payout-review");
  }, [price, amounts, exact]);

  const startPayday = useCallback(
    async (of: NonNullable<PayoutRun["payday"]>, schedule: Schedule, left: ScheduleItem[]) => {
      const names = new Map(latest.current.contacts.map((c) => [c.id, c.name]));
      const items = await price(left.map(({ amount, exact, ...i }): Target => ({ ...i, name: names.get(i.contactId) ?? i.name, ...(exact !== undefined ? { exact } : { amount: amount! }) })));
      if (!items) return;
      setPayday({ of, moves: reviewMoves(schedule, items) });
      setReview(items);
      latest.current.go("payout-review");
    },
    [price],
  );

  const execute = useCallback(
    async (r: PayoutRun) => {
      const d = deps();
      if (!d || busy.current) return;
      busy.current = true;
      setRunning(true);
      const total = r.items.filter((i) => i.state === "todo" || i.state === "stopped").reduce((n, i) => n + Number(i.amount), 0);
      latest.current.sheetAmount(`${total.toFixed(2)} ${PAY_SYM}`);
      save(r);
      try {
        const end = await runPayout(d, r);
        // A payday is over when everyone is paid; its prices are the ones the next payday is compared with.
        if (ready && end.payday && runFinished(end)) {
          const s = ready.store.schedules(ready.account).find((x) => x.ruleId === end.payday!.ruleId);
          if (s) ready.store.patchSchedule(ready.account, s.ruleId, { doneAt: end.payday.at, rates: paidRates(s, end) });
        }
      } finally {
        busy.current = false;
        setRunning(false);
        setStage(null);
        latest.current.refreshBalances();
      }
    },
    [deps, save, ready],
  );

  const confirm = useCallback(() => {
    if (!review?.length || busy.current) return;
    const r: PayoutRun = { id: newId(), at: new Date().toISOString(), items: review, ...(payday ? { payday: payday.of } : {}) };
    setReview(null);
    setPayday(null);
    setAmounts({});
    setExactState({});
    latest.current.go("payout-run", { replace: true });
    void execute(r);
  }, [review, payday, execute]);

  const resume = useCallback(() => {
    if (run) void execute(run);
  }, [run, execute]);

  const edit = (index: number, p: Partial<PayoutItem>) => {
    if (!run || busy.current) return;
    save({ ...run, items: run.items.map((x, n) => (n === index ? { ...x, ...p } : x)) });
  };

  return {
    exact,
    setExact,
    amounts,
    setAmount,
    review,
    reviewing,
    run,
    running,
    stage,
    requestReview: () => void requestReview(),
    reviewMoves: payday?.moves ?? null,
    startPayday,
    confirm,
    resume,
    acceptHeld: (i) => {
      const x = run?.items[i];
      if (x?.state !== "held" || !x.heldOut) return;
      const price = x.exact !== undefined ? { amount: formatUnits(BigInt(x.heldOut), DECIMALS[x.from]) } : { reviewedOut: x.heldOut };
      edit(i, { state: "todo", ...price, heldOut: undefined });
    },
    resolveUnknown: (i, was) => {
      if (run?.items[i]?.state === "unknown") edit(i, was === "paid" ? { state: "paid" } : { state: "todo", hashes: undefined, quoteId: undefined, calls: undefined });
    },
    clear: () => {
      if (busy.current || !ready) return;
      ready.store.setPayoutRun(ready.account, null);
      setRunState(null);
    },
  };
}
