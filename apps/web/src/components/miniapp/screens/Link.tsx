"use client";

import { useState } from "react";
import { fill } from "../../../i18n/miniapp";
import { linkMessage } from "../../../lib/miniapp/contract";
import { isUserRejection } from "../../../lib/miniapp/client/wallet";
import { useApp } from "../context";
import { ActionBar, Logo, NoMoneyMoved } from "../ui";

/** Telegram bot handle (docs/STATUS.md: @arbolitoo_bot). */
export const TELEGRAM_BOT = "https://t.me/arbolitoo_bot";

/** The 4-digit linking code from a /app/link?code=1234 URL, or null. */
export function codeFromUrl(): string | null {
  const c = typeof window !== "undefined" ? (new URLSearchParams(window.location.search).get("code") ?? "") : "";
  return /^\d{4}$/.test(c) ? c : null;
}

/** The code as four big digits (shown in the Mini App and on the outside-MiniPay gate). */
export function CodeDigits({ code }: { code: string }) {
  return (
    <div className="mp-card" style={{ padding: "20px 16px", display: "flex", justifyContent: "center", gap: 10 }} aria-label={code.split("").join(" ")}>
      {code.split("").map((d, i) => (
        <span key={i} className="mp-mono" style={{ width: 52, height: 64, borderRadius: 12, background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 600 }}>
          {d}
        </span>
      ))}
    </div>
  );
}

/**
 * /app/link: "Conectá tu MiniPay con Telegram". The bot shows a 4-digit code (/conectar). With
 * ?code= the code is prefilled and confirmed with one tap; without it (Ajustes → Telegram) the
 * user types it. Typing is the path that always works: Telegram can't open an unlisted mini app
 * inside MiniPay, so its link lands in Telegram's own browser. No message signing (MiniPay rule).
 */
export function LinkScreen() {
  const { t, api, account, wallet, showError, openLink } = useApp();
  const [urlCode] = useState(codeFromUrl);
  const [code, setCode] = useState(urlCode ?? "");
  const typed = urlCode === null;
  const valid = /^\d{4}$/.test(code);
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [who, setWho] = useState<string | null>(null);

  const connect = async () => {
    if (!valid) return;
    setState("busy");
    try {
      // MiniPay shows the code in its signing sheet: the wallet proves it's the one being linked.
      const proof = await wallet.signer.personalSign(linkMessage(code, account));
      const r = await api.linkConfirm({ code, account, proof });
      if (r.linked) {
        setWho(r.telegramName);
        setState("done");
      } else setState("fail");
    } catch (e) {
      if (isUserRejection(e)) return setState("idle");
      const c = (e as { code?: string }).code;
      if (c === "bad_request") setState("fail");
      else {
        setState("idle");
        showError((c as Parameters<typeof showError>[0]) ?? "network");
      }
    }
  };
  const home = () => {
    window.location.href = window.location.pathname.replace(/\/link\/?$/, "") + window.location.search.replace(/([?&])code=\d+&?/, "$1").replace(/[?&]$/, "");
  };

  if (state === "done")
    return (
      <>
        <div className="mp-scroll">
          <div className="mp-center">
            <div className="mp-circle ok" style={{ fontSize: 32 }}>
              ✓
            </div>
            <h1 className="mp-h1">{t.lnkDoneT}</h1>
            <p className="mp-p">{fill(t.lnkDoneB, { n: who ? ` (${who})` : "" })}</p>
          </div>
        </div>
        <ActionBar primary={{ label: t.seeAccount, onClick: home }} />
      </>
    );

  if (typed)
    return (
      <>
        <div className="mp-scroll">
          <div className="mp-center">
            <Logo size={56} />
            <h1 className="mp-h1">{t.lnkTitle}</h1>
            <ol className="mp-soft" style={{ margin: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10, alignSelf: "stretch" }}>
              {[t.lnkStep1, t.lnkStep2].map((s, i) => (
                <li key={s} className="mp-row" style={{ alignItems: "baseline" }}>
                  <span className="mp-mono mp-save" style={{ fontWeight: 600, fontSize: 14 }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: 16, lineHeight: 1.4 }}>{s}</span>
                </li>
              ))}
            </ol>
            <button type="button" className="mp-link inline" onClick={() => openLink(TELEGRAM_BOT)}>
              {t.lnkOpenBot} ↗
            </button>
            <label className="mp-field" style={{ alignSelf: "stretch" }}>
              <span>{t.lnkCodeLbl}</span>
              <input
                className="mp-input mono"
                style={{ fontSize: 28, letterSpacing: ".4em", textAlign: "center" }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 4));
                  if (state === "fail") setState("idle");
                }}
                placeholder="0000"
              />
            </label>
            {state === "fail" ? (
              <div className="mp-banner" role="alert">
                {t.lnkFail}
              </div>
            ) : null}
            <div className="mp-small">{t.lnkSignNote}</div>
          </div>
        </div>
        <ActionBar
          primary={state === "busy" ? { label: t.lnkConnect, kind: "busy" } : valid ? { label: t.lnkConnect, onClick: () => void connect() } : { label: t.lnkConnect, kind: "off" }}
          secondary={{ label: t.cancel, onClick: home }}
        />
      </>
    );

  return (
    <>
      <div className="mp-scroll">
        <div className="mp-center">
          <Logo size={56} />
          <h1 className="mp-h1">{t.lnkTitle}</h1>
          <p className="mp-p">{t.lnkBody}</p>
          <CodeDigits code={code} />
          <div className="mp-small">{t.lnkSignNote}</div>
          {state === "fail" ? (
            <>
              <div className="mp-banner" role="alert">
                {t.lnkFail}
              </div>
              <NoMoneyMoved t={t} />
            </>
          ) : null}
        </div>
      </div>
      <ActionBar
        primary={state !== "fail" ? (state === "busy" ? { label: t.lnkConnect, kind: "busy" } : { label: t.lnkConnect, onClick: () => void connect() }) : { label: t.backHome, onClick: home }}
        secondary={state !== "fail" ? { label: t.cancel, onClick: home } : null}
      />
    </>
  );
}
