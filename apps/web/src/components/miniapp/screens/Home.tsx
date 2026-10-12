"use client";

import { fill } from "../../../i18n/miniapp";
import { byCurrency, totalIn, usdToCur } from "../../../lib/miniapp/client/derive";
import { CUR_OF, CURS, fmtMoney, fmtSym } from "../../../lib/miniapp/client/format";
import { useApp } from "../context";
import { Badge, Logo } from "../ui";
import { useReceiptList, whenLabel } from "../useReceipts";

export function Home() {
  const app = useApp();
  const { t, lang, persona, bal, prices, displayCur, auto, receipts, go } = app;
  const loading = bal.status === "loading" && !bal.data;
  const muted = bal.status !== "ok";
  const cur = byCurrency(bal.data);
  const empty = bal.status === "ok" && CURS.every((c) => cur[c].amount18 === 0n);
  const total = bal.data ? totalIn(bal.data, displayCur, prices) : null;
  const recent = receipts.slice(0, 4);
  const details = useReceiptList(app.api, recent.map((r) => r.receiptId));
  const minutes = bal.at ? Math.max(1, Math.round((Date.now() - bal.at) / 60_000)) : null;
  const actions = [
    { glyph: "⇄", label: t.aChange, to: "change" as const },
    { glyph: "↗", label: t.aSend, to: "send" as const },
    { glyph: "+", label: t.aAdd, to: "add" as const },
    { glyph: "↓", label: t.aWithdraw, to: "withdraw" as const },
  ];

  return (
    <div className="mp-scroll">
      <div className="mp-pad">
        <div className="mp-between" style={{ padding: "0 4px" }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.01em" }}>{persona ? fill(t.hello, { n: persona.name }) : t.helloAnon}</div>
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

        <div className="mp-ink-card">
          <div style={{ fontSize: 15, opacity: 0.8 }}>{fill(t.totalIn, { c: t.curLower[displayCur] })}</div>
          {loading ? (
            <div style={{ height: 40, width: "70%", borderRadius: 8, background: "color-mix(in oklab, var(--bg) 14%, transparent)", margin: "4px 0" }} />
          ) : (
            <div className="mp-tab" style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1.1, opacity: muted ? 0.6 : 1 }}>
              {total !== null ? fmtMoney(total, 18, displayCur, lang) : "—"}
            </div>
          )}
          <div style={{ fontSize: 14, lineHeight: 1.4, opacity: 0.75, paddingTop: 6, marginTop: 6, borderTop: "1px dashed color-mix(in oklab, currentColor 22%, transparent)" }}>{t.onlyHere}</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
          {actions.map((a) => (
            <button key={a.to} type="button" onClick={() => go(a.to)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, border: 0, background: "transparent", color: "var(--text)", padding: "4px 0", minHeight: 44 }}>
              <span style={{ width: 56, height: 56, borderRadius: 18, background: "var(--surface)", border: "1px solid var(--hairline)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700 }} aria-hidden="true">
                {a.glyph}
              </span>
              <span style={{ fontSize: 14, lineHeight: 1.2, fontWeight: 600, textAlign: "center" }}>{a.label}</span>
            </button>
          ))}
        </div>

        <button type="button" onClick={() => go("chat")} className="mp-row" style={{ gap: 10, minHeight: 52, padding: "0 6px 0 16px", borderRadius: 26, border: "1px solid var(--hairline)", background: "var(--surface)", color: "var(--muted)", fontSize: 16, textAlign: "left" }}>
          <span className="mp-grow">{t.askPh}</span>
          <span className="mp-mic" style={{ width: 40, height: 40 }} aria-hidden="true">
            ●
          </span>
        </button>

        <div className="mp-card">
          <div className="mp-kicker" style={{ padding: "14px 16px 4px" }}>
            {t.balances}
          </div>
          {CURS.map((c) => {
            const eq = c === displayCur ? null : usdToCur(cur[c].usdMicros, displayCur, prices);
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
                  {eq !== null && !loading ? <span className="mp-meta">≈ {fmtMoney(eq, 18, displayCur, lang, { dp: 0 })}</span> : null}
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

        {!auto?.configured ? (
          <button type="button" className="mp-dashed mp-row" onClick={() => go("auto-intro")} style={{ textAlign: "left", padding: "14px 16px", color: "var(--text)", gap: 14, borderRadius: 18 }}>
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
