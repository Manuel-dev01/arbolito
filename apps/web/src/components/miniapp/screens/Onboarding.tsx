"use client";

import { useEffect, useState } from "react";
import { fill } from "../../../i18n/miniapp";
import { balanceOf } from "../../../lib/miniapp/client/derive";
import { Frame, useApp } from "../context";
import { Badge, Spinner, Wordmark } from "../ui";

export function Welcome() {
  const { t, setSheet, finishOnboarding } = useApp();
  return (
    <Frame primary={{ label: t.start, onClick: () => finishOnboarding("add") }}>
      <div className="mp-pad wide" style={{ flex: 1, gap: 24, paddingTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="mp-chip" onClick={() => setSheet("lang")} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {t.langName} <span style={{ color: "var(--muted)" }}>▾</span>
          </button>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
          <Wordmark />
          <h1 className="mp-h1 xl">{t.welTitle}</h1>
          <p className="mp-p">{t.welBody}</p>
        </div>
        <ol style={{ margin: 0, padding: 0, listStyle: "none", borderTop: "1px dashed var(--hairline)" }}>
          {[t.welS1, t.welS2, t.welS3].map((s, i) => (
            <li key={s} className="mp-row" style={{ gap: 14, alignItems: "baseline", padding: "14px 0", borderBottom: "1px dashed var(--hairline)" }}>
              <span className="mp-mono mp-save" style={{ fontWeight: 600, fontSize: 14 }}>
                0{i + 1}
              </span>
              <span style={{ fontSize: 16, lineHeight: 1.4 }}>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mp-meta" style={{ textAlign: "center" }}>
          {t.welLangNote}
        </div>
      </div>
    </Frame>
  );
}

/** MiniPay Add Cash deeplink (docs.minipay.xyz → Deeplinks). */
export const ADD_CASH_URL = "https://link.minipay.xyz/add_cash?tokens=USDT,USDC,USDM";

export function AddMoney() {
  const { t, go, openLink, toast, mock } = useApp();
  const later = () => go("done-ob");
  return (
    <Frame secondary={{ label: t.later, onClick: later }}>
      <div className="mp-pad wide" style={{ paddingTop: 8 }}>
        <h1 className="mp-h1">{t.addTitle}</h1>
        <p className="mp-p">{t.addBody}</p>
        <button
          type="button"
          className="mp-option"
          onClick={() => {
            toast(t.toastMP);
            if (!mock) openLink(ADD_CASH_URL);
          }}
        >
          <div className="mp-between" style={{ width: "100%" }}>
            <Badge cur="USD" />
            <span className="mp-mono" style={{ fontSize: 13, color: "var(--muted)" }}>
              {t.opensMP} ↗
            </span>
          </div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>{t.addCashT}</div>
          <div style={{ fontSize: 16, lineHeight: 1.45, color: "var(--muted)" }}>{t.addCashS}</div>
        </button>
        <button type="button" className="mp-option" onClick={() => go("add-ripio")}>
          <div className="mp-between" style={{ width: "100%" }}>
            <span style={{ display: "flex" }}>
              <span style={{ border: "2px solid var(--bg)", borderRadius: "50%", display: "flex" }}>
                <Badge cur="ARS" />
              </span>
              <span style={{ marginLeft: -12, border: "2px solid var(--bg)", borderRadius: "50%", display: "flex" }}>
                <Badge cur="BRL" />
              </span>
            </span>
            <span className="mp-tag save">{t.guided}</span>
          </div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>{t.addRipioT}</div>
          <div style={{ fontSize: 16, lineHeight: 1.45, color: "var(--muted)" }}>{t.addRipioS}</div>
        </button>
      </div>
    </Frame>
  );
}

export function AddRipio() {
  const { t, lang, startRipio, go } = useApp();
  const [sym, setSym] = useState<"wARS" | "wBRL">(lang === "pt" ? "wBRL" : "wARS");
  return (
    <Frame primary={{ label: `${t.openRipio} ↗`, onClick: () => startRipio(sym) }} secondary={{ label: t.didIt, onClick: () => go("add-waiting") }}>
      <div className="mp-pad wide" style={{ gap: 18, paddingTop: 8 }}>
        <h1 className="mp-h1 md">{t.ripTitle}</h1>
        <div className="mp-field">
          <span>{t.ripWhich}</span>
          <div className="mp-seg" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {(["wARS", "wBRL"] as const).map((s) => (
              <button key={s} type="button" aria-pressed={sym === s} onClick={() => setSym(s)}>
                {t.curName[s === "wARS" ? "ARS" : "BRL"]}
              </button>
            ))}
          </div>
        </div>
        <ol className="mp-card" style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {[t.rip1, t.rip2, t.rip3].map((s, i) => (
            <li key={s} className="mp-row" style={{ gap: 14, alignItems: "flex-start", padding: 16, borderBottom: i < 2 ? "1px solid var(--hairline)" : 0 }}>
              <span className={`mp-step-dot ${i === 0 ? "on" : ""}`}>{i + 1}</span>
              <span style={{ fontSize: 16, lineHeight: 1.45 }}>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mp-small">{t.ripNote}</div>
      </div>
    </Frame>
  );
}

export function AddWaiting() {
  const { t, store, account, bal, refreshBalances, go, toast } = useApp();
  const pending = store.pendingRipio(account);
  // Watch the balance: when the Ripio transfer lands, move on by itself.
  useEffect(() => {
    const id = setInterval(refreshBalances, 10_000);
    return () => clearInterval(id);
  }, [refreshBalances]);
  useEffect(() => {
    if (!pending || !bal.data) return;
    if (balanceOf(bal.data, pending.sym as "wARS" | "wBRL") > BigInt(pending.before)) {
      store.setPendingRipio(account, null);
      toast(t.arrived);
      go(store.onboarded(account) ? "home" : "done-ob", { replace: true });
    }
  }, [bal.data, pending, store, account, toast, t, go]);
  const next = () => {
    store.setOnboarded(account);
    go("done-ob");
  };
  return (
    <Frame primary={{ label: t.next, onClick: next }}>
      <div className="mp-center" style={{ gap: 16 }}>
        <div className="mp-circle neutral" style={{ width: 56, height: 56 }}>
          <Spinner size={26} />
        </div>
        <h1 className="mp-h1">{t.waitTitle}</h1>
        <p className="mp-p">{t.waitBody}</p>
        <div className="mp-soft" style={{ fontSize: 15, lineHeight: 1.5 }}>
          {t.waitNote}
        </div>
      </div>
    </Frame>
  );
}

export function DoneOnboarding() {
  const { t, persona, go } = useApp();
  return (
    <Frame primary={{ label: t.goChat, onClick: () => go("chat") }} secondary={{ label: t.seeAccount, onClick: () => go("home") }}>
      <div className="mp-center">
        <div className="mp-circle ok" style={{ fontSize: 32 }}>
          ✓
        </div>
        <h1 className="mp-h1 lg">{persona ? fill(t.doneTitle, { n: persona.name }) : t.doneTitleAnon}</h1>
        <p className="mp-p">{t.doneBody}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <div className="mp-bubble user">{t.ex1}</div>
          <div className="mp-bubble user">{t.ex2}</div>
        </div>
        <button type="button" className="mp-dashed mp-row" onClick={() => go("auto-intro")} style={{ marginTop: 8, textAlign: "left", padding: "14px 16px", color: "var(--text)", gap: 14 }}>
          <span className="mp-grow mp-col">
            <span className="mp-kicker" style={{ fontSize: 12 }}>
              {t.optional}
            </span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{t.autoTitle}</span>
          </span>
          <span style={{ fontSize: 22, color: "var(--muted)" }}>›</span>
        </button>
      </div>
    </Frame>
  );
}
