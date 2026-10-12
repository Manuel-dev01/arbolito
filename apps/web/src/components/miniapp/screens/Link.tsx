"use client";

import { useState } from "react";
import { fill } from "../../../i18n/miniapp";
import { useApp } from "../context";
import { ActionBar, Logo, NoMoneyMoved } from "../ui";

/**
 * /app/link?code=1234: "Conectá tu MiniPay". The same 4-digit code shows in Telegram; one tap
 * confirms it. No message signing (MiniPay rule); proof format is TBD by the backend (contract `proof?`).
 */
export function LinkScreen() {
  const { t, api, account, go, showError } = useApp();
  const [code] = useState(() => {
    const c = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("code") ?? "" : "";
    return /^\d{4}$/.test(c) ? c : null;
  });
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [who, setWho] = useState<string | null>(null);

  const connect = async () => {
    if (!code) return;
    setState("busy");
    try {
      const r = await api.linkConfirm({ code, account });
      if (r.linked) {
        setWho(r.telegramName);
        setState("done");
      } else setState("fail");
    } catch (e) {
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

  return (
    <>
      <div className="mp-scroll">
        <div className="mp-center">
          <Logo size={56} />
          <h1 className="mp-h1">{t.lnkTitle}</h1>
          {code ? (
            <>
              <p className="mp-p">{t.lnkBody}</p>
              <div className="mp-card" style={{ padding: "20px 16px", display: "flex", justifyContent: "center", gap: 10 }} aria-label={code.split("").join(" ")}>
                {code.split("").map((d, i) => (
                  <span key={i} className="mp-mono" style={{ width: 52, height: 64, borderRadius: 12, background: "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 600 }}>
                    {d}
                  </span>
                ))}
              </div>
              <div className="mp-small">{t.lnkNote}</div>
            </>
          ) : null}
          {!code || state === "fail" ? (
            <>
              <div className="mp-banner" role="alert">
                {code ? t.lnkFail : t.lnkBadCode}
              </div>
              <NoMoneyMoved t={t} />
            </>
          ) : null}
        </div>
      </div>
      <ActionBar
        primary={code && state !== "fail" ? (state === "busy" ? { label: t.lnkConnect, kind: "busy" } : { label: t.lnkConnect, onClick: () => void connect() }) : { label: t.backHome, onClick: home }}
        secondary={code && state !== "fail" ? { label: t.cancel, onClick: home } : null}
      />
    </>
  );
  void go;
}
