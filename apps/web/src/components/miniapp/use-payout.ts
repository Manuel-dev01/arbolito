"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import type { ApiClient, Quote } from "../../lib/miniapp/client/api";
import type { ClientErrorCode } from "../../lib/miniapp/client/errors";
import type { ExecStage } from "../../lib/miniapp/client/execute";
import { SYM_OF, type Lang } from "../../lib/miniapp/client/format";
import { MAX_PAYEES, restoreRun, runPayout, settleReceipts, type PayoutDeps, type PayoutItem, type PayoutRun } from "../../lib/miniapp/client/payout";
import { newId, type Contact, type ReceiptIndexEntry, type Store } from "../../lib/miniapp/client/store";
import type { Wallet } from "../../lib/miniapp/client/wallet";
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

export interface PayoutCtx {
  amounts: Record<string, string>;
  setAmount(contactId: string, typed: string): void;
  review: PayoutItem[] | null;
  reviewing: boolean;
  run: PayoutRun | null;
  running: boolean;
  /** The payment in progress and where its confirmations are. */
  stage: { index: number; stage: ExecStage } | null;
  requestReview(): void;
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
  const [review, setReview] = useState<PayoutItem[] | null>(null);
  const [reviewing, setReviewing] = useState(false);
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
  }, []);

  const requestReview = useCallback(async () => {
    if (!ready || reviewing) return;
    const picked = latest.current.contacts.filter((c) => payable(c) && payoutAmount(amounts[c.id])).slice(0, MAX_PAYEES);
    if (!picked.length) return;
    setReviewing(true);
    const items: PayoutItem[] = [];
    try {
      // Three at a time: each is a live quote across venues.
      for (let i = 0; i < picked.length; i += 3) {
        const part = picked.slice(i, i + 3);
        const quotes: Quote[] = await Promise.all(
          part.map((c) => {
            const ask = () => ready.api.quote({ from: PAY_SYM, to: SYM_OF[c.cur], amount: payoutAmount(amounts[c.id])!, account: ready.account, lang: latest.current.lang });
            // A quote is free and moves nothing: one slow market shouldn't cost the whole review.
            return ask().catch((e: { code?: ClientErrorCode }) => (e.code === "upstream" || e.code === "network" ? ask() : Promise.reject(e)));
          }),
        );
        part.forEach((c, n) =>
          items.push({ contactId: c.id, name: c.name, address: c.address!, from: PAY_SYM, to: SYM_OF[c.cur], amount: payoutAmount(amounts[c.id])!, reviewedOut: quotes[n]!.expectedOut, state: "todo" }),
        );
      }
      // Same currency together, so one approval serves them all.
      items.sort((a, b) => a.to.localeCompare(b.to));
      setReview(items);
      latest.current.go("payout-review");
    } catch (e) {
      latest.current.showError((e as { code?: ClientErrorCode }).code ?? "network");
    } finally {
      setReviewing(false);
    }
  }, [ready, reviewing, amounts]);

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
        await runPayout(d, r);
      } finally {
        busy.current = false;
        setRunning(false);
        setStage(null);
        latest.current.refreshBalances();
      }
    },
    [deps, save],
  );

  const confirm = useCallback(() => {
    if (!review?.length || busy.current) return;
    const r: PayoutRun = { id: newId(), at: new Date().toISOString(), items: review };
    setReview(null);
    setAmounts({});
    latest.current.go("payout-run", { replace: true });
    void execute(r);
  }, [review, execute]);

  const resume = useCallback(() => {
    if (run) void execute(run);
  }, [run, execute]);

  const edit = (index: number, p: Partial<PayoutItem>) => {
    if (!run || busy.current) return;
    save({ ...run, items: run.items.map((x, n) => (n === index ? { ...x, ...p } : x)) });
  };

  return {
    amounts,
    setAmount,
    review,
    reviewing,
    run,
    running,
    stage,
    requestReview: () => void requestReview(),
    confirm,
    resume,
    acceptHeld: (i) => {
      const x = run?.items[i];
      if (x?.state === "held" && x.heldOut) edit(i, { state: "todo", reviewedOut: x.heldOut, heldOut: undefined });
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
