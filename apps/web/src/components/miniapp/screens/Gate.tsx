"use client";

import type { MiniDict } from "../../../i18n/miniapp";
import { useEffect, useRef, useState } from "react";
import { ActionBar, Logo, NoMoneyMoved } from "../ui";
import { CodeDigits } from "./Link";

/** The only two wallet messages MiniPay allows: not inside MiniPay, and connection failed. */
export function Gate({ kind, t, onRetry, linkCode }: { kind: "no-minipay" | "conn-fail"; t: MiniDict; onRetry(): void; linkCode?: string | null }) {
  const [appUrl, setAppUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setAppUrl(window.location.href); }, []);
  const copyUrl = async () => {
    try { await navigator.clipboard.writeText(appUrl); setCopied(true); }
    catch { input.current?.focus(); input.current?.select(); }
  };
  if (kind === "conn-fail")
    return (
      <>
        <div className="mp-scroll">
          <div className="mp-center" style={{ gap: 16, padding: "32px 24px" }}>
            <div className="mp-circle warn">!</div>
            <h1 className="mp-h1">{t.connTitle}</h1>
            <p className="mp-p">{t.connBody}</p>
            <NoMoneyMoved t={t} />
          </div>
        </div>
        <ActionBar primary={{ label: t.retry, onClick: onRetry }} />
      </>
    );
  const demo = () => {
    const u = new URL(window.location.href);
    u.searchParams.set("mock", "1");
    window.location.href = u.toString();
  };
  return (
    <>
      <div className="mp-scroll">
        <div className="mp-center" style={{ gap: 20, padding: "32px 24px" }}>
          <Logo size={64} />
          <h1 className="mp-h1 lg">{linkCode ? t.lnkGateT : t.noMpTitle}</h1>
          {linkCode ? <CodeDigits code={linkCode} /> : <p className="mp-p">{t.noMpBody}</p>}
          <p className="mp-p" style={{ fontSize: 15 }}>{t.handoffNote}</p>
          <input ref={input} className="mp-input" aria-label={t.appLink} readOnly value={appUrl} onFocus={(e) => e.currentTarget.select()} />
          <ol className="mp-soft" style={{ margin: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
            {(linkCode ? [t.lnkGate1, t.lnkGate2, t.lnkGate3] : [t.noMp1, t.noMp2, t.noMp3]).map((s, i) => (
              <li key={s} className="mp-row" style={{ alignItems: "baseline" }}>
                <span className="mp-mono mp-save" style={{ fontWeight: 600, fontSize: 14 }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 16, lineHeight: 1.4 }}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <ActionBar primary={{ label: copied ? t.appLinkCopied : t.copyAppLink, onClick: () => void copyUrl() }} secondary={{ label: t.openMP, onClick: () => (window.location.href = "https://link.minipay.xyz/balance") }} />
      <button type="button" className="mp-link" onClick={demo}>{t.tryDemo}</button>
    </>
  );
}
