"use client";

import { useEffect } from "react";
import { fill } from "../../../i18n/miniapp";
import { byCurrency, totalIn, usdToCur } from "../../../lib/miniapp/client/derive";
import { CUR_OF, CURS, fmtMoney, fmtSym, shortHex, type Cur } from "../../../lib/miniapp/client/format";
import { useApp } from "../context";
import { Badge, Icon, Logo } from "../ui";
import { useReceiptList, whenLabel } from "../useReceipts";

const LOC = { es: "es-AR", pt: "pt-BR", en: "en-US" } as const;

/** "Buenas tardes" by the phone's clock: a greeting that reads complete without a name. */
function greeting(t: ReturnType<typeof useApp>["t"]): string {
  const h = new Date().getHours();
  return h < 5 ? t.greetEvening : h < 12 ? t.greetMorning : h < 19 ? t.greetAfternoon : t.greetEvening;
}

/** Today's dollar in pesos and reais, from the same prices the totals use; the official peso for contrast. */
function RatesStrip() {
  const { t, lang, prices, rates } = useApp();
  const per = (c: Cur) => (prices[c] ? 1e6 / Number(prices[c]) : null);
  const ars = per("ARS");
  const brl = per("BRL");
  const officialRef = rates?.references.find((r) => r.name === "official" && r.pair.toUpperCase() === "USD/ARS");
  const official = officialRef ? Number(officialRef.rate) : null;
  if (ars === null && brl === null) return null;
  const n = (v: number, dp: number) => v.toLocaleString(LOC[lang], { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const gap = ars !== null && official ? ((ars / official - 1) * 100).toFixed(1) : null;
  return (
    <div className="mp-card" style={{ padding: "14px 16px", gap: 10, display: "flex", flexDirection: "column" }}>
      <div className="mp-kicker">{t.todayDollar}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {ars !== null ? (
          <div className="mp-col" style={{ gap: 4 }}>
            <span className="mp-row" style={{ gap: 8 }}>
              <Badge cur="ARS" size={22} />
              <span className="mp-meta">{t.curName.ARS}</span>
            </span>
            <span className="mp-tab" style={{ fontSize: 20, fontWeight: 800 }}>
              ARS {n(ars, 0)}
            </span>
            {official && gap ? (
              <span className="mp-meta">
                {t.rateOfficial} {n(official, 0)} · <b className="mp-save">{Number(gap) >= 0 ? "+" : ""}{n(Number(gap), 1)}%</b>
              </span>
            ) : null}
          </div>
        ) : null}
        {brl !== null ? (
          <div className="mp-col" style={{ gap: 4 }}>
            <span className="mp-row" style={{ gap: 8 }}>
              <Badge cur="BRL" size={22} />
              <span className="mp-meta">{t.curName.BRL}</span>
            </span>
            <span className="mp-tab" style={{ fontSize: 20, fontWeight: 800 }}>
              R$ {n(brl, 2)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Home() {
  const app = useApp();
  const { t, lang, persona, account, bal, prices, displayCur, auto, receipts, rules, refreshRules, go } = app;
  const loading = bal.status === "loading" && !bal.data;
  const muted = bal.status !== "ok";
  const cur = byCurrency(bal.data);
  const empty = bal.status === "ok" && CURS.every((c) => cur[c].amount18 === 0n);
  const total = bal.data ? totalIn(bal.data, displayCur, prices) : null;
  const recent = receipts.slice(0, 4);
  const details = useReceiptList(app.api, recent.map((r) => r.receiptId));
  const minutes = bal.at ? Math.max(1, Math.round((Date.now() - bal.at) / 60_000)) : null;
  const on = !!auto?.configured && !auto.paused && auto.operatorActive;
  useEffect(() => {
    if (on) refreshRules();
  }, [on, refreshRules]);

  // Each action gets its own tint from the logo's palette; Change (the main thing) is filled.
  const actions = [
    { icon: "swap", label: t.aChange, to: "change", tile: { background: "var(--primary-bg)", color: "var(--primary-text)", border: "1px solid transparent" } },
    { icon: "send", label: t.aSend, to: "send", tile: { background: "color-mix(in oklab, var(--a2) 16%, var(--surface))", color: "var(--a2)" } },
    { icon: "plus", label: t.aAdd, to: "add", tile: { background: "color-mix(in oklab, var(--a1) 14%, var(--surface))", color: "var(--a1)" } },
    { icon: "withdraw", label: t.aWithdraw, to: "withdraw", tile: { background: "var(--surface)", color: "var(--text)" } },
  ] as const;

  // The split of the total by currency, for the bar under it.
  const usdTotal = CURS.reduce((s, c) => s + cur[c].usdMicros, 0n);
  const split = usdTotal > 0n ? CURS.map((c) => ({ c, pct: Number((cur[c].usdMicros * 1000n) / usdTotal) / 10 })).filter((x) => x.pct > 0) : [];
  const activeRules = (rules ?? []).filter((r) => r.status === "active").length;

  return (
    <div className="mp-scroll">
      <div className="mp-pad">
        <div className="mp-between" style={{ padding: "0 4px" }}>
          <div className="mp-col" style={{ gap: 2 }}>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.01em" }}>{persona ? fill(t.hello, { n: persona.name }) : greeting(t)}</div>
            <span className="mp-mono" style={{ fontSize: 13, color: "var(--muted)" }}>
              MiniPay · {shortHex(account)}
            </span>
          </div>
          <button type="button" className="mp-avatar" onClick={() => go("settings")} aria-label={t.tabSettings}>
            {persona ? persona.name[0] : <Logo size={26} />}
          </button>
        </div>

        {bal.status === "offline" ? (
          <div className="mp-banner" role="status">
            <span style={{ fontWeight: 800 }}>!</span>
            <span>{bal.data && minutes ? fill(t.offline, { m: minutes }) : t.offlineNoCache}</span>
          </div>
        ) : null}
        {auto?.configured && auto.paused ? (
          <button type="button" className="mp-banner" onClick={() => go("security")} style={{ alignItems: "center" }}>
            <span className="mp-grow">{t.pausedHome}</span>
            <span style={{ fontWeight: 700 }}>›</span>
          </button>
        ) : null}
        {on ? (
          <button type="button" className="mp-agent" onClick={() => go("security")}>
            <span className="mp-agent-dot" aria-hidden="true" />
            <span className="mp-grow" style={{ fontWeight: 700 }}>
              {t.agentOn}
            </span>
            <span className="mp-meta">{rules === null ? "…" : activeRules === 1 ? t.agentRule1 : fill(t.agentRules, { n: activeRules })}</span>
            <Icon name="chevron" size={18} />
          </button>
        ) : null}

        <div className="mp-ink-card mp-hero">
          <svg className="mp-hero-orbs" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="21" cy="31" r="11" fill="var(--a1)" />
            <circle cx="43" cy="31" r="11" fill="var(--a3)" />
            <circle cx="32" cy="17" r="12" fill="var(--a2)" />
          </svg>
          <div style={{ fontSize: 15, opacity: 0.8 }}>{fill(t.totalIn, { c: t.curLower[displayCur] })}</div>
          {loading ? (
            <div style={{ height: 40, width: "70%", borderRadius: 8, background: "color-mix(in oklab, var(--bg) 14%, transparent)", margin: "4px 0" }} />
          ) : (
            <div className="mp-tab" style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.1, opacity: muted ? 0.6 : 1 }}>
              {total !== null ? fmtMoney(total, 18, displayCur, lang) : "—"}
            </div>
          )}
          {split.length > 1 ? (
            <div className="mp-col" style={{ gap: 8, marginTop: 6 }}>
              <div className="mp-split" role="img" aria-label={split.map((s) => `${t.curName[s.c]} ${s.pct}%`).join(", ")}>
                {split.map((s) => (
                  <span key={s.c} className={`mp-split-seg ${s.c}`} style={{ width: `${s.pct}%` }} />
                ))}
              </div>
              <div className="mp-row" style={{ gap: 14, flexWrap: "wrap", fontSize: 13, opacity: 0.85 }}>
                {split.map((s) => (
                  <span key={s.c} className="mp-row" style={{ gap: 6 }}>
                    <span className={`mp-split-dot ${s.c}`} />
                    {t.curName[s.c]} {Math.round(s.pct)}%
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <div style={{ fontSize: 13, lineHeight: 1.4, opacity: 0.7, paddingTop: 8, marginTop: 6, borderTop: "1px dashed color-mix(in oklab, currentColor 22%, transparent)" }}>{t.onlyHere}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
          {actions.map((a) => (
            <button key={a.to} type="button" onClick={() => go(a.to)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, border: 0, background: "transparent", color: "var(--text)", padding: "4px 0", minHeight: 44 }}>
              <span className="mp-action-tile" style={a.tile} aria-hidden="true">
                <Icon name={a.icon} size={24} stroke={2.2} />
              </span>
              <span style={{ fontSize: 14, lineHeight: 1.2, fontWeight: 600, textAlign: "center" }}>{a.label}</span>
            </button>
          ))}
        </div>

        <button type="button" onClick={() => go("chat")} className="mp-row" style={{ gap: 10, minHeight: 52, padding: "0 6px 0 14px", borderRadius: 26, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--muted)", fontSize: 16, textAlign: "left" }}>
          <span style={{ color: "var(--a2)", display: "flex" }}>
            <Icon name="spark" size={20} />
          </span>
          <span className="mp-grow">{t.askPh}</span>
          <span className="mp-mic" style={{ width: 40, height: 40 }} aria-hidden="true">
            <Icon name="mic" size={20} />
          </span>
        </button>

        <RatesStrip />

        <div className="mp-card">
          <div className="mp-kicker" style={{ padding: "14px 16px 4px" }}>
            {t.balances}
          </div>
          {CURS.map((c) => {
            const eq = c === displayCur ? null : usdToCur(cur[c].usdMicros, displayCur, prices);
            // Small amounts keep their cents ("≈ US$ 1.01", not "≈ US$ 1").
            const eqDp = eq !== null && eq < 100n * 10n ** 18n ? 2 : 0;
            return (
              <div key={c} className="mp-list-row" style={{ cursor: "default" }}>
                <Badge cur={c} />
                <div className="mp-grow mp-col" style={{ gap: 2 }}>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{t.curName[c]}</span>
                  <span className="mp-mono" style={{ fontSize: 13, color: "var(--muted)" }}>
                    {c === "USD" ? `USD · ${t.alsoInMP}` : c}
                  </span>
                </div>
                <div className="mp-col" style={{ alignItems: "flex-end", gap: 2 }}>
                  <span className="mp-tab" style={{ fontSize: 17, fontWeight: 700, color: muted ? "var(--muted)" : "var(--text)" }}>
                    {loading ? "—" : fmtMoney(cur[c].amount18, 18, c, lang)}
                  </span>
                  {eq !== null && !loading ? <span className="mp-meta">≈ {fmtMoney(eq, 18, displayCur, lang, { dp: eqDp })}</span> : null}
                </div>
              </div>
            );
          })}
        </div>

        {empty ? (
          <div className="mp-soft" style={{ display: "flex", flexDirection: "column", gap: 12, borderStyle: "dashed", borderRadius: 18, padding: 20 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{t.emptyTitle}</div>
            <div style={{ fontSize: 16, lineHeight: 1.45, color: "var(--muted)" }}>{t.emptyBody}</div>
            <button type="button" className="mp-btn" style={{ borderRadius: 14, minHeight: 52 }} onClick={() => go("add")}>
              {t.addMoney}
            </button>
          </div>
        ) : null}

        {auto !== null && !auto.configured ? (
          <button type="button" className="mp-dashed mp-row" onClick={() => go("auto-intro")} style={{ textAlign: "left", padding: "14px 16px", color: "var(--text)", gap: 14, borderRadius: 18 }}>
            <span style={{ color: "var(--a3)", display: "flex" }}>
              <Icon name="spark" size={22} />
            </span>
            <span className="mp-grow mp-col">
              <span style={{ fontSize: 16, fontWeight: 700 }}>{t.autoTitle}</span>
              <span style={{ fontSize: 15, lineHeight: 1.4, color: "var(--muted)" }}>{t.autoPromo}</span>
            </span>
            <span style={{ fontSize: 22, color: "var(--muted)" }}>›</span>
          </button>
        ) : null}

        <div className="mp-card">
          <div className="mp-kicker" style={{ padding: "14px 16px 4px" }}>
            {t.activity}
          </div>
          {recent.length === 0 ? <div style={{ padding: "12px 16px 18px", fontSize: 16, lineHeight: 1.45, color: "var(--muted)" }}>{t.emptyAct}</div> : null}
          {recent.map((r) => {
            const d = details.get(r.receiptId);
            const title = r.kind === "send" ? fill(t.actSend, { n: r.to ?? "" }) : d ? fill(t.actChange, { a: t.curLower[CUR_OF[d.from]], b: t.curLower[CUR_OF[d.to]] }) : t.rcKindChange;
            return (
              <button key={r.receiptId} type="button" className="mp-list-row" style={{ minHeight: 60 }} onClick={() => app.openReceipt(r.receiptId)}>
                <span className="mp-act-icon" style={r.kind === "send" ? { color: "var(--a2)" } : { color: "var(--save-text)" }} aria-hidden="true">
                  <Icon name={r.kind === "send" ? "send" : "swap"} size={18} />
                </span>
                <span className="mp-grow mp-col" style={{ gap: 3 }}>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
                  <span className="mp-meta">{whenLabel(r.at, lang, t)}</span>
                </span>
                <span className="mp-tab" style={{ fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", color: r.kind === "send" ? "var(--text)" : "var(--save-text)" }}>
                  {d ? (r.kind === "send" ? `−${fmtSym(d.amountIn, d.from, lang)}` : `+${fmtSym(d.amountOut, d.to, lang)}`) : ""}
                </span>
              </button>
            );
          })}
          {recent.length > 0 ? (
            <button type="button" className="mp-link" style={{ width: "100%", minHeight: 52, fontSize: 16 }} onClick={() => go("receipts")}>
              {t.seeReceipts}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
