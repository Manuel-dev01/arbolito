"use client";

import { MINIAPP_LANGS } from "../../i18n/miniapp";
import type { SheetRequest } from "../../lib/miniapp/client/mock";
import { useApp } from "./context";
import { Sheet } from "./ui";

export function LangSheet() {
  const { t, lang, setLang, setSheet } = useApp();
  return (
    <Sheet label={t.langPick} onClose={() => setSheet(null)}>
      <div className="mp-sheet-title">{t.langPick}</div>
      {MINIAPP_LANGS.map((l) => (
        <button key={l} type="button" className="mp-lang-opt" aria-pressed={l === lang} onClick={() => setLang(l)}>
          <span>{t.langLabels[l]}</span>
          <span className="mp-save" style={{ fontWeight: 800 }}>
            {l === lang ? "✓" : ""}
          </span>
        </button>
      ))}
    </Sheet>
  );
}

/** "Ver detalles": fees, route and tolerance. Hex and token tickers live only here. */
export function DetailsSheet() {
  const { t, ch, setSheet, lang } = useApp();
  const q = ch.quote;
  const tol = q && BigInt(q.expectedOut) > 0n ? Number(((BigInt(q.expectedOut) - BigInt(q.minOut)) * 10000n) / BigInt(q.expectedOut)) / 100 : 0.5;
  const route = q ? (q.steps >= 2 ? `${q.from} → USDT → ${q.to}` : `${q.from} → ${q.to}`) : "—";
  const venues = q ? q.venues.map((v) => (v === "uniswap" ? "Uniswap" : "Textile")).join(" + ") : "";
  const rows: [string, string][] = [
    [t.detMarket, t.detMarketV],
    [t.detFee, t.detFeeV],
    [t.detNet, t.detNetV],
    [t.detRoute, venues ? `${route} · ${venues}` : route],
    [t.detTol, `${tol.toLocaleString(lang === "en" ? "en-US" : lang === "pt" ? "pt-BR" : "es-AR", { maximumFractionDigits: 2 })}%`],
    [t.detNetwork, "Celo"],
  ];
  return (
    <Sheet label={t.detTitle} onClose={() => setSheet(null)}>
      <div className="mp-sheet-title">{t.detTitle}</div>
      <div style={{ display: "flex", flexDirection: "column", borderTop: "1px dashed var(--hairline)" }}>
        {rows.map(([k, v]) => (
          <div key={k} className="mp-between" style={{ padding: "12px 0", borderBottom: "1px dashed var(--hairline)", alignItems: "flex-start" }}>
            <span className="mp-small">{k}</span>
            <span className="mp-mono" style={{ fontSize: 14, textAlign: "right" }}>
              {v}
            </span>
          </div>
        ))}
      </div>
      <div className="mp-meta">{t.detNote}</div>
      <button type="button" className="mp-btn quiet" onClick={() => setSheet(null)}>
        {t.close}
      </button>
    </Sheet>
  );
}

/**
 * Demo only (?mock=1): a stand-in for MiniPay's native confirmation sheet, like the prototype's
 * grey sheet. In real MiniPay this never renders; MiniPay shows its own sheet.
 */
export function MiniPaySheet({ req, amount, onAnswer }: { req: SheetRequest; amount: string; onAnswer(ok: boolean): void }) {
  const { t } = useApp();
  const rows: [string, string][] =
    req.kind === "sign"
      ? [
          [t.mpApp, "arbolito.app"],
          [t.mpAction, `${t.mpSignTitle} · ${req.label}`],
        ]
      : [
          [t.mpApp, "arbolito.app"],
          [t.mpAction, req.label],
          ...(amount ? ([[t.mpAmount, amount]] as [string, string][]) : []),
          [t.mpFee, t.mpFeeV],
        ];
  return (
    <div className="mp-overlay" role="dialog" aria-modal="true" aria-label={req.kind === "sign" ? t.mpSignTitle : t.mpTitle} style={{ background: "rgba(0,0,0,.5)" }}>
      <div className="mp-mpsheet">
        <div className="mp-grabber" />
        <div className="mp-mpsheet-ref">{t.mpRef}</div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>{req.kind === "sign" ? t.mpSignTitle : t.mpTitle}</div>
        <div className="mp-mpsheet-rows">
          {rows.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
        <div className="mp-mpsheet-btns">
          <button type="button" onClick={() => onAnswer(false)}>
            {t.mpReject}
          </button>
          <button type="button" className="confirm" onClick={() => onAnswer(true)}>
            {t.mpConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
