"use client";

import { fill } from "../../../i18n/miniapp";
import { fmtSym, maskPhone } from "../../../lib/miniapp/client/format";
import { Frame, useApp } from "../context";
import { Badge, Logo, Switch } from "../ui";
import { fmtDate, useLocalEq } from "./Autonomy";

/** Telegram bot handle (docs/STATUS.md: @arbolitoo_bot). Linking starts in the bot, which sends /app/link?code=…. */
const TELEGRAM_BOT = "https://t.me/arbolitoo_bot";

export function Security() {
  const { t, lang, auto, contacts, setPaused, go } = useApp();
  const eq = useLocalEq();
  const on = !!auto?.configured;
  const paused = on && !!auto?.paused;
  const usd = auto?.limits.find((l) => l.sym === "USDT") ?? auto?.limits[0];
  const perTx = usd ? Number(BigInt(usd.perTx) / 10_000n) / 100 : null;
  const perDay = usd ? Number(BigInt(usd.perDay) / 10_000n) / 100 : null;
  const spent = usd ? Number(BigInt(usd.spentToday) / 10_000n) / 100 : 0;
  const names = (auto?.contacts ?? [])
    .map((a) => contacts.find((c) => c.address?.toLowerCase() === a.toLowerCase())?.name.split(" ")[0])
    .filter(Boolean)
    .join(", ");
  const expiry = auto?.operatorExpiry ? fmtDate(new Date(auto.operatorExpiry), lang) : "";
  const tone = paused ? { bg: "var(--attention-bg)", fg: "var(--attention-text)" } : on ? { bg: "var(--save-bg)", fg: "var(--save-text)" } : { bg: "var(--surface-2)", fg: "var(--text)" };
  const money = (n: number | null) => (n === null ? "—" : usd ? fmtSym(BigInt(Math.round(n * 1e6)), "USDT", lang, { dp: 0 }) : "—");
  return (
    <div className="mp-scroll">
      <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
        <div className="mp-col" style={{ gap: 6, borderRadius: 18, padding: "16px 18px", background: tone.bg, color: tone.fg }}>
          <span className="mp-mono" style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>
            {paused ? t.secTagPaused : on ? t.secTagOn : t.secTagOff}
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{paused ? t.secTitlePaused : on ? t.secTitleOn : t.secTitleOff}</span>
          <span style={{ fontSize: 15, lineHeight: 1.45 }}>{paused ? t.secSubPaused : on ? fill(t.secSubOn, { op: money(perTx), day: money(perDay), date: expiry }) : t.secSubOff}</span>
        </div>
        {on ? (
          <>
            <div className="mp-card">
              <button type="button" role="switch" aria-checked={paused} className="mp-list-row" onClick={() => setPaused(!paused)}>
                <span className="mp-grow mp-col" style={{ gap: 3 }}>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>{t.secPause}</span>
                  <span className="mp-meta">{t.secPauseSub}</span>
                </span>
                <Switch on={paused} />
              </button>
              {usd ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--hairline)" }}>
                  <div className="mp-between" style={{ fontSize: 16 }}>
                    <span style={{ color: "var(--muted)" }}>{t.secPerOp}</span>
                    <span style={{ fontWeight: 600 }}>
                      {money(perTx)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>{perTx !== null ? eq(perTx) : ""}</span>
                    </span>
                  </div>
                  <div className="mp-between" style={{ fontSize: 16 }}>
                    <span style={{ color: "var(--muted)" }}>{t.secPerDay}</span>
                    <span style={{ fontWeight: 600 }}>
                      {money(perDay)} <span style={{ color: "var(--muted)", fontWeight: 400 }}>{perDay !== null ? eq(perDay) : ""}</span>
                    </span>
                  </div>
                  <div className="mp-col" style={{ gap: 6 }}>
                    <div style={{ height: 8, borderRadius: 4, background: "var(--surface-2)" }}>
                      <div style={{ width: `${perDay ? Math.min(100, (spent / perDay) * 100) : 0}%`, height: 8, borderRadius: 4, background: "var(--save-text)" }} />
                    </div>
                    <span className="mp-meta">{fill(t.secUsed, { x: money(spent), y: money(perDay) })}</span>
                  </div>
                </div>
              ) : null}
              <button type="button" className="mp-list-row" style={{ minHeight: 56, justifyContent: "space-between", fontWeight: 600 }} onClick={() => go("auto-limits")}>
                <span>{t.secChangeLimits}</span>
                <span className="mp-meta" style={{ fontWeight: 400 }}>
                  {t.secOneConfirm} ›
                </span>
              </button>
              <button type="button" className="mp-list-row" style={{ minHeight: 56, justifyContent: "space-between", fontWeight: 600 }} onClick={() => go("auto-contacts")}>
                <span>{t.secContacts}</span>
                <span className="mp-meta" style={{ fontWeight: 400 }}>
                  {names || auto?.contacts.length || 0} ›
                </span>
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="mp-btn" onClick={() => go("auto-intro")}>
            {t.secTurnOn}
          </button>
        )}
        <div className="mp-card pad" style={{ gap: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{t.secPhoneT}</span>
          <span className="mp-small">{t.secPhoneB}</span>
        </div>
        {on ? (
          <button type="button" className="mp-btn" style={{ borderRadius: 14, minHeight: 52, fontSize: 16, background: "transparent", color: "var(--danger)", border: "1px solid var(--danger)" }} onClick={() => go("revoke")}>
            {t.secRevoke}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Revoke() {
  const { t, autoDraft, revokeAuto, go, setPaused } = useApp();
  return (
    <Frame primary={autoDraft.busy ? { label: t.openingMP, kind: "busy" } : { label: t.revokeMP, onClick: revokeAuto, kind: "danger" }} secondary={{ label: t.cancel, onClick: () => go("security") }}>
      <div className="mp-pad wide">
        <h1 className="mp-h1">{t.revT}</h1>
        <div style={{ borderTop: "1px dashed var(--hairline)" }}>
          {[
            t.rev1,
            <>
              <b>{t.rev2a}</b> {t.rev2b}
            </>,
            t.rev3,
            t.rev4,
          ].map((x, i) => (
            <div key={i} style={{ padding: "14px 0", borderBottom: "1px dashed var(--hairline)", fontSize: 16, lineHeight: 1.45 }}>
              {x}
            </div>
          ))}
        </div>
        <div className="mp-small">
          {t.revBreath}{" "}
          <button
            type="button"
            className="mp-link inline"
            onClick={() => {
              setPaused(true);
              go("security", { replace: true });
            }}
          >
            {t.revPauseInstead}
          </button>
        </div>
      </div>
    </Frame>
  );
}

export function Settings() {
  const { t, persona, contacts, auto, displayCur, setSheet, go, openLink, mock, toast } = useApp();
  const tag = auto?.configured ? (auto.paused ? t.secTagPaused : t.secTagOn) : t.secTagOff;
  const row = { minHeight: 56, justifyContent: "space-between", fontWeight: 600, padding: "0 16px" } as const;
  return (
    <div className="mp-scroll">
      <div className="mp-pad" style={{ gap: 14 }}>
        <div className="mp-row" style={{ gap: 14, padding: 4 }}>
          <span className="mp-avatar" style={{ width: 56, height: 56, fontSize: 22, fontWeight: 800 }}>
            {persona ? persona.name[0] : <Logo size={32} />}
          </span>
          <span className="mp-col" style={{ gap: 3 }}>
            {persona ? <span style={{ fontSize: 19, fontWeight: 700 }}>{persona.name}</span> : null}
            {persona ? (
              <span className="mp-mono" style={{ fontSize: 14, color: "var(--muted)" }}>
                {maskPhone(persona.phone)}
              </span>
            ) : null}
            <span className="mp-meta">{t.setAccount}</span>
          </span>
        </div>
        <div className="mp-card">
          <button type="button" className="mp-list-row" style={row} onClick={() => setSheet("lang")}>
            <span>{t.setLang}</span>
            <span style={{ fontWeight: 400, color: "var(--muted)" }}>{t.langName} ›</span>
          </button>
          <div className="mp-list-row" style={{ ...row, cursor: "default" }}>
            <span>{t.setDisp}</span>
            <span className="mp-row" style={{ gap: 8, fontWeight: 400, color: "var(--muted)" }}>
              <Badge cur={displayCur} size={24} /> {t.curName[displayCur]} ({displayCur})
            </span>
          </div>
          <button type="button" className="mp-list-row" style={row} onClick={() => go("send")}>
            <span>{t.setContacts}</span>
            <span style={{ fontWeight: 400, color: "var(--muted)" }}>{contacts.length} ›</span>
          </button>
          <button type="button" className="mp-list-row" style={row} onClick={() => go("security")}>
            <span>{t.setSecurity}</span>
            <span style={{ fontWeight: 400, color: "var(--muted)" }}>{tag} ›</span>
          </button>
          <button
            type="button"
            className="mp-list-row"
            style={row}
            onClick={() => {
              // TODO(contract): no endpoint tells the app whether this wallet is linked to Telegram (and as whom).
              if (mock) toast("@lucia.dg");
              else openLink(TELEGRAM_BOT);
            }}
          >
            <span>{t.setTelegram}</span>
            <span style={{ fontWeight: 400, color: "var(--muted)" }}>{mock ? "@lucia.dg" : t.setTgHow} ›</span>
          </button>
        </div>
        <div className="mp-meta" style={{ padding: "0 4px", lineHeight: 1.5 }}>
          {t.setFoot}
        </div>
      </div>
    </div>
  );
}

/** Ripio off-ramp (docs/04-reference.md); dollars stay in MiniPay (its Pockets screen). */
const RIPIO_OFFRAMP = "https://ramp.ripio.com/offramp";
const MINIPAY_POCKETS = "https://link.minipay.xyz/balance";

export function Withdraw() {
  const { t, openLink, toast, mock } = useApp();
  const open = (url: string, msg: string) => {
    toast(msg);
    if (!mock) openLink(url);
  };
  return (
    // TODO(contract): the design's in-app "ARS 50.000 → tu cuenta Ripio" needs an off-ramp prepare endpoint; until then this hands off to Ripio.
    <div className="mp-scroll">
      <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
        <button type="button" className="mp-option" style={{ border: "2px solid var(--save-text)", borderRadius: 18 }} onClick={() => open(RIPIO_OFFRAMP, t.toastMP.replace("MiniPay", "Ripio"))}>
          <span className="mp-between" style={{ width: "100%" }}>
            <span style={{ fontSize: 17, fontWeight: 700 }}>{t.wdRipioT}</span>
            <span style={{ display: "flex" }}>
              <Badge cur="ARS" size={32} />
              <span style={{ marginLeft: -10 }}>
                <Badge cur="BRL" size={32} />
              </span>
            </span>
          </span>
          <span className="mp-small">{t.wdRipioB}</span>
          <span className="mp-link inline" style={{ minHeight: 0 }}>
            {t.openRipioOff} ↗
          </span>
        </button>
        <button type="button" className="mp-option" onClick={() => open(MINIPAY_POCKETS, t.toastMP)}>
          <span className="mp-between" style={{ width: "100%" }}>
            <span style={{ fontSize: 17, fontWeight: 700 }}>{t.wdUsdT}</span>
            <span className="mp-mono" style={{ fontSize: 13, color: "var(--muted)" }}>
              {t.opensMP} ↗
            </span>
          </span>
          <span className="mp-small">{t.wdUsdB}</span>
        </button>
      </div>
    </div>
  );
}
