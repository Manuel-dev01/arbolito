"use client";

import { useEffect, useState } from "react";
import { describeEvery, morningHourUtc, nextPayday, peopleCount, type PayrollEvery } from "@arbolito/rules";
import { fill } from "../../../i18n/miniapp";
import { CUR_OF, fmtMoney, fmtSym, parseHuman, DECIMALS, type Lang } from "../../../lib/miniapp/client/format";
import type { ScheduleItem } from "../../../lib/miniapp/client/payday";
import { runFinished } from "../../../lib/miniapp/client/payout";
import { Frame, useApp } from "../context";
import { Badge, Spinner } from "../ui";

const LOC = { es: "es-AR", pt: "pt-BR", en: "en-US" } as const;

const whenNext = (d: Date, lang: Lang) => d.toLocaleString(LOC[lang], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(/\./g, "");

const amountOf = (i: Pick<ScheduleItem, "to" | "amount" | "exact">, lang: Lang) =>
  i.exact !== undefined ? fmtSym(parseHuman(i.exact, DECIMALS[i.to]), i.to, lang) : fmtMoney(parseHuman(i.amount ?? "0", 6), 6, "USD", lang);

/** On the home screen, on a payday: what the agent found, and what to do about it. */
export function PaydayCards() {
  const { t, lang, paydays, payout, go } = useApp();
  const { refresh } = paydays;
  useEffect(() => refresh(), [refresh]);
  return (
    <>
      {paydays.due.map((d) => {
        const started = payout.run?.payday?.ruleId === d.schedule.ruleId && payout.run.payday.at === d.at && !runFinished(payout.run);
        return (
          <div key={d.schedule.ruleId} className={d.held && !started ? "mp-banner col" : "mp-card pad"} role="status" style={{ gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 700 }}>{fill(t.pdDueT, { n: peopleCount(d.schedule.items.length, lang) })}</span>
            <span className="mp-small" style={{ color: "inherit" }}>
              {started ? t.pdStarted : d.held ? fill(t.pdDueHeld, { r: d.note ?? "" }) : t.pdDueReady}
            </span>
            <span className="mp-row" style={{ gap: 16, flexWrap: "wrap" }}>
              <button type="button" className="mp-link inline" disabled={paydays.busy} onClick={() => (started ? go("payout-run") : paydays.open(d))}>
                {paydays.busy ? <Spinner size={16} color="currentColor" /> : started ? t.poContinue : t.pdReview}
              </button>
              {started ? null : (
                <button type="button" className="mp-link muted inline" onClick={() => paydays.skip(d)}>
                  {t.pdSkip}
                </button>
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}

/** "Repeat this payout": how often, and how far the price may move before a payday is held. */
export function PaydayNew() {
  const { t, lang, paydays, telegram, go } = useApp();
  const today = new Date();
  const [unit, setUnit] = useState<"week" | "month">("week");
  const [weekday, setWeekday] = useState(5);
  const [day, setDay] = useState(25);
  const [tolerance, setTolerance] = useState(3);
  const items = paydays.draft;
  if (!items?.length) return <Paydays />;
  const every: PayrollEvery = unit === "week" ? { unit, weekday } : { unit, day };
  const next = nextPayday({ every, hourUtc: morningHourUtc(today.getTimezoneOffset()) }, today);
  // 2026-11-01 was a Sunday: weekday names in the app's language, without a list of our own.
  const weekdayName = (d: number) => new Date(Date.UTC(2026, 10, 1 + d)).toLocaleDateString(LOC[lang], { weekday: "short", timeZone: "UTC" }).replace(".", "");
  return (
    <Frame
      note={t.pdSignNote}
      primary={paydays.busy ? { label: t.openingMP, kind: "busy" } : { label: t.pdSign, onClick: () => paydays.create(every, tolerance) }}
      secondary={{ label: t.cancel, onClick: () => go("home") }}
    >
      <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
        <h1 className="mp-h1 md">{t.pdNewT}</h1>
        <p className="mp-p">{t.pdNewB}</p>
        <div className="mp-seg" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {(["week", "month"] as const).map((u) => (
            <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}>
              {u === "week" ? t.pdWeekly : t.pdMonthly}
            </button>
          ))}
        </div>
        {unit === "week" ? (
          <div className="mp-row" style={{ gap: 8, flexWrap: "wrap" }}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button key={d} type="button" className="mp-chip" aria-pressed={weekday === d} style={weekday === d ? { background: "var(--primary-bg)", color: "var(--primary-text)" } : undefined} onClick={() => setWeekday(d)}>
                {weekdayName(d)}
              </button>
            ))}
          </div>
        ) : (
          <label className="mp-row" style={{ gap: 12 }}>
            <span className="mp-grow" style={{ fontSize: 16 }}>
              {t.pdDay}
            </span>
            <select className="mp-input" value={day} onChange={(e) => setDay(Number(e.target.value))} style={{ width: 96, minHeight: 44 }}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mp-small">{fill(t.pdNext, { d: whenNext(next, lang) })}</div>
        <div className="mp-col" style={{ gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{t.pdTolerance}</span>
          <div className="mp-seg">
            {[1, 3, 5].map((p) => (
              <button key={p} type="button" aria-pressed={tolerance === p} onClick={() => setTolerance(p)}>
                {p}%
              </button>
            ))}
          </div>
        </div>
        <div className="mp-card">
          {items.map((i) => (
            <div key={i.contactId} className="mp-list-row">
              <Badge cur={CUR_OF[i.to]} size={32} />
              <span className="mp-grow" style={{ fontSize: 16, fontWeight: 600 }}>
                {i.name}
              </span>
              <span className="mp-tab" style={{ fontSize: 16, fontWeight: 700 }}>
                {amountOf({ to: i.to as ScheduleItem["to"], ...(i.exact !== undefined ? { exact: i.exact } : { amount: i.amount }) }, lang)}
              </span>
            </div>
          ))}
        </div>
        {telegram && !telegram.linked ? <div className="mp-soft mp-small">{t.pdNoTg}</div> : null}
      </div>
    </Frame>
  );
}

/** The schedules that are on, each with Cancel (signed in MiniPay). */
export function Paydays() {
  const { t, lang, paydays, contacts, go } = useApp();
  const { load } = paydays;
  useEffect(() => load(), [load]);
  const none = paydays.rules !== null && paydays.rules.length === 0;
  return (
    <Frame primary={none ? { label: t.poEntry, onClick: () => go("payout") } : null} secondary={{ label: t.backHome, onClick: () => go("home") }}>
      <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
        <h1 className="mp-h1 md">{t.hPaydays}</h1>
        <p className="mp-p">{none ? t.pdEmpty : t.pdListB}</p>
        {paydays.rules === null ? <Spinner /> : null}
        {(paydays.rules ?? []).map((r) => {
          const s = paydays.schedules.find((x) => x.ruleId === r.ruleId);
          return (
            <div key={r.ruleId} className="mp-card">
              <div className="mp-col" style={{ padding: "14px 16px", gap: 4 }}>
                <span style={{ fontSize: 17, fontWeight: 700 }}>{s ? `${describeEvery(s.every, lang)} · ${peopleCount(s.items.length, lang)}` : r.description}</span>
                <span className="mp-meta">{r.status === "stopped" ? fill(t.ruleStopped, { r: r.stoppedReason ?? "" }) : r.nextRunAt ? fill(t.pdNext, { d: whenNext(new Date(r.nextRunAt), lang) }) : ""}</span>
                {s ? <span className="mp-meta">{fill(t.pdHoldAt, { p: `${s.tolerancePct}%` })}</span> : <span className="mp-meta">{t.pdOtherPhone}</span>}
              </div>
              {(s?.items ?? []).map((i) => (
                <div key={i.address} className="mp-list-row">
                  <span className="mp-grow">{contacts.find((c) => c.id === i.contactId)?.name ?? i.name}</span>
                  <span className="mp-tab" style={{ fontWeight: 700 }}>
                    {amountOf(i, lang)}
                  </span>
                </div>
              ))}
              <button type="button" className="mp-link inline" style={{ padding: "0 16px", alignSelf: "flex-start" }} disabled={paydays.busy} onClick={() => paydays.cancel(r.ruleId)}>
                {paydays.busy ? <Spinner size={16} color="currentColor" /> : t.pdCancel}
              </button>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}
