"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { PayrollParams, cancelText, morningHourUtc, payrollText, ratesOf, type PayrollEvery } from "@arbolito/rules";
import type { ApiClient, Rule, RulesList } from "../../lib/miniapp/client/api";
import type { ClientErrorCode } from "../../lib/miniapp/client/errors";
import type { Lang } from "../../lib/miniapp/client/format";
import { duePaydays, fillsOf, leftToPay, payrollParams, scheduleItems, type Due, type Schedule } from "../../lib/miniapp/client/payday";
import { runFinished, type PayoutItem } from "../../lib/miniapp/client/payout";
import { newId, type Store } from "../../lib/miniapp/client/store";
import { isUserRejection, type Wallet } from "../../lib/miniapp/client/wallet";
import type { Screen } from "./screens";
import type { PayoutCtx } from "./use-payout";

export interface PaydaysCtx {
  /** The account's schedules on the server (null until loaded), and this phone's copy of their lists. */
  rules: Rule[] | null;
  schedules: Schedule[];
  due: Due[];
  /** The payments being turned into a schedule. */
  draft: PayoutItem[] | null;
  busy: boolean;
  /** For the home screen: asks the server only when this phone has a schedule. */
  refresh(): void;
  load(): void;
  /** "Repeat this payout". */
  repeat(items: PayoutItem[]): void;
  create(every: PayrollEvery, tolerancePct: number): void;
  cancel(ruleId: string): void;
  /** Prices what is left of a payday, for review. */
  open(due: Due): void;
  skip(due: Due): void;
}

interface Ready {
  account: Address;
  api: ApiClient;
  wallet: Wallet;
  store: Store;
}

export function usePaydays(
  ready: Ready | null,
  o: { lang: Lang; payout: PayoutCtx; go(s: Screen, o?: { replace?: boolean }): void; showError(c: ClientErrorCode): void; toast(m: string): void; text: { allPaid: string; created: string; cancelled: string; twice: string } },
): PaydaysCtx {
  const [list, setList] = useState<RulesList | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [draft, setDraft] = useState<PayoutItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(o);
  latest.current = o;

  const reload = useCallback(() => {
    if (ready) setSchedules(ready.store.schedules(ready.account));
  }, [ready]);
  // A finished or skipped payday is recorded in the store by the payout itself.
  const runState = o.payout.run;
  useEffect(reload, [reload, runState]);

  const load = useCallback(() => {
    if (!ready) return;
    ready.api.listRules(ready.account).then(setList, () => {});
  }, [ready]);

  const refresh = useCallback(() => {
    if (ready && ready.store.schedules(ready.account).length) load();
  }, [ready, load]);

  const fail = (e: unknown) => {
    if (!isUserRejection(e)) latest.current.showError((e as { code?: ClientErrorCode }).code ?? "network");
  };

  const create = useCallback(
    async (every: PayrollEvery, tolerancePct: number) => {
      if (!ready || !draft?.length || busy) return;
      const s = { items: scheduleItems(draft), every, hourUtc: morningHourUtc(new Date().getTimezoneOffset()), tolerancePct, rates: ratesOf(fillsOf(draft)) };
      const params = payrollParams(s);
      if (new Set(params.payees.map((p) => p.address)).size !== params.payees.length) return latest.current.toast(latest.current.text.twice);
      if (!PayrollParams.safeParse(params).success) return latest.current.showError("bad_request");
      setBusy(true);
      try {
        const { lang } = latest.current;
        const id = newId();
        const signature = await ready.wallet.signer.personalSign(payrollText(params, id, getAddress(ready.account), lang));
        await ready.api.createPayroll({ id, account: ready.account, lang, params, signature });
        ready.store.saveSchedule(ready.account, { ruleId: id, ...s });
        setDraft(null);
        reload();
        load();
        latest.current.toast(latest.current.text.created);
        latest.current.go("paydays", { replace: true });
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [ready, draft, busy, reload, load],
  );

  const cancel = useCallback(
    async (ruleId: string) => {
      if (!ready || busy) return;
      setBusy(true);
      try {
        const signature = await ready.wallet.signer.personalSign(cancelText(ruleId, ready.account));
        await ready.api.cancelRule({ ruleId, account: ready.account, signature });
        ready.store.removeSchedule(ready.account, ruleId);
        setList((l) => (l ? { ...l, rules: l.rules.filter((r) => r.ruleId !== ruleId) } : l));
        reload();
        latest.current.toast(latest.current.text.cancelled);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [ready, busy, reload],
  );

  const skip = useCallback(
    (due: Due) => {
      if (!ready) return;
      ready.store.patchSchedule(ready.account, due.schedule.ruleId, { doneAt: due.at });
      reload();
    },
    [ready, reload],
  );

  const open = useCallback(
    async (due: Due) => {
      if (!ready || busy) return;
      const { payout, go } = latest.current;
      // One payout at a time: an open one is finished (or closed) first, so nothing is paid twice.
      if (payout.run && !runFinished(payout.run)) return go("payout-run");
      setBusy(true);
      try {
        // Without the server's record this can't say who was already paid, so it doesn't guess.
        const receipts = await ready.api.listReceipts(ready.account);
        const fresh = ready.store.schedules(ready.account).find((s) => s.ruleId === due.schedule.ruleId) ?? due.schedule;
        const left = leftToPay({ ...due, schedule: fresh }, receipts);
        if (!left.length) {
          skip(due);
          return latest.current.toast(latest.current.text.allPaid);
        }
        await payout.startPayday({ ruleId: fresh.ruleId, at: due.at, before: fresh.paid?.at === due.at ? fresh.paid.to : [] }, fresh, left);
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [ready, busy, skip],
  );

  const rules = list ? list.rules.filter((r) => r.kind === "payroll" && r.status !== "draft") : null;
  return {
    rules,
    schedules,
    due: list ? duePaydays(schedules, list, Date.now()) : [],
    draft,
    busy,
    refresh,
    load,
    repeat: (items) => {
      setDraft(items);
      latest.current.go("payday-new");
    },
    create: (e, t) => void create(e, t),
    cancel: (id) => void cancel(id),
    open: (d) => void open(d),
    skip,
  };
}
