"use client";

import type { MiniDict } from "../../../i18n/miniapp";
import { ActionBar, Logo, NoMoneyMoved } from "../ui";

/** The only two wallet messages MiniPay allows: not inside MiniPay, and connection failed. */
export function Gate({ kind, t, onRetry }: { kind: "no-minipay" | "conn-fail"; t: MiniDict; onRetry(): void }) {
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
          <h1 className="mp-h1 lg">{t.noMpTitle}</h1>
          <p className="mp-p">{t.noMpBody}</p>
          <ol className="mp-soft" style={{ margin: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 12 }}>
            {[t.noMp1, t.noMp2, t.noMp3].map((s, i) => (
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
      {/* MiniPay's Discover tab deeplink; outside a phone with MiniPay it offers the install. */}
      <ActionBar primary={{ label: t.openMP, onClick: () => (window.location.href = "https://link.minipay.xyz/discover") }} secondary={{ label: t.tryDemo, onClick: demo }} />
    </>
  );
}
