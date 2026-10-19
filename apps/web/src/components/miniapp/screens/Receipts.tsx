"use client";

import { useState } from "react";
import { fill } from "../../../i18n/miniapp";
import type { Receipt } from "../../../lib/miniapp/client/api";
import { DECIMALS, fmtPct, fmtRateLine, fmtSaved, fmtSym, gainOf, receiptRef, shortHex } from "../../../lib/miniapp/client/format";
import type { Sym } from "../../../lib/miniapp/contract";
import { Frame, useApp } from "../context";
import { ReceiptBadge, Spinner } from "../ui";
import { monthLabel, useReceipt, useReceiptList, whenLabel } from "../useReceipts";

/** to-units per from-unit as an 18-decimal string, for fmtRateLine. */
function rateString(amountIn: bigint, from: Sym, amountOut: bigint, to: Sym): string {
  if (amountIn === 0n) return "0";
  const r = (amountOut * 10n ** BigInt(DECIMALS[from]) * 10n ** 18n) / (amountIn * 10n ** BigInt(DECIMALS[to]));
  const s = r.toString().padStart(19, "0");
  return `${s.slice(0, -18)}.${s.slice(-18)}`;
}

export function ReceiptsList() {
  const { t, lang, api, receipts, openReceipt } = useApp();
  const data = useReceiptList(api, receipts.map((r) => r.receiptId));
  const groups: { month: string; items: typeof receipts }[] = [];
  for (const r of receipts) {
    const m = monthLabel(r.at, lang);
    const g = groups.at(-1);
    if (g && g.month === m) g.items.push(r);
    else groups.push({ month: m, items: [r] });
  }
  return (
    <div className="mp-scroll">
      <div className="mp-pad" style={{ gap: 14 }}>
        <h1 className="mp-h1 md">{t.rcTitle}</h1>
        {receipts.length === 0 ? (
          <div className="mp-soft" style={{ display: "flex", flexDirection: "column", gap: 10, borderStyle: "dashed", borderRadius: 18, padding: "24px 20px" }}>
            <span style={{ fontSize: 18, fontWeight: 700 }}>{t.rcEmptyT}</span>
            <span style={{ fontSize: 16, lineHeight: 1.45, color: "var(--muted)" }}>{t.rcEmptyB}</span>
          </div>
        ) : null}
        {groups.map((g) => (
          <div key={g.month} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="mp-kicker" style={{ padding: "4px 4px 0" }}>
              {g.month}
            </div>
            <div className="mp-card">
              {g.items.map((r) => {
                const d = data.get(r.receiptId);
                return (
                  <button key={r.receiptId} type="button" className="mp-list-row" style={{ minHeight: 68 }} onClick={() => openReceipt(r.receiptId)}>
                    <span className="mp-grow mp-col" style={{ gap: 3 }}>
                      <span className="mp-tab" style={{ fontSize: 16, fontWeight: 700 }}>
                        {d ? `${fmtSym(d.amountIn, d.from, lang)} → ${fmtSym(d.amountOut, d.to, lang)}` : receiptRef(r.receiptId)}
                      </span>
                      <span className="mp-meta">
                        {whenLabel(r.at, lang, t)} · {r.kind === "send" ? fill(t.rcKindSend, { n: r.to ?? "" }) : t.rcKindChange}
                      </span>
                    </span>
                    <span className="mp-col" style={{ alignItems: "flex-end", gap: 4 }}>
                      {d?.savings ? (
                        <span className={gainOf(d.savings) ? "mp-save" : "mp-meta"} style={{ fontSize: 14, fontWeight: 700 }}>
                          {fmtPct(d.savings.pct, lang)}
                        </span>
                      ) : null}
                      {d ? <ReceiptBadge status={d.status} t={t} /> : <Spinner size={12} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function share(url: string, t: ReturnType<typeof useApp>["t"], toast: (m: string) => void) {
  const abs = new URL(url, window.location.origin).toString();
  const nav = navigator as Navigator & { share?: (d: { url: string; title?: string }) => Promise<void> };
  if (nav.share) {
    nav.share({ url: abs, title: "Arbolito" }).catch(() => {});
    return;
  }
  navigator.clipboard?.writeText(abs).then(
    () => toast(t.toastShare),
    () => toast(abs),
  );
}

export function ReceiptDetail() {
  const { t, lang, api, receiptId, receipts, toast, openLink } = useApp();
  const { data: r, error } = useReceipt(api, receiptId);
  const [tech, setTech] = useState(false);
  const entry = receipts.find((x) => x.receiptId === receiptId);
  if (!r)
    return (
      <div className="mp-scroll">
        <div className="mp-center">{error ? <p className="mp-p">{t.errOffline}</p> : <Spinner size={26} />}</div>
      </div>
    );
  return (
    <Frame primary={{ label: t.rcShare, onClick: () => share(r.url, t, toast), kind: "quiet" }}>
      <ReceiptBody r={r} when={whenLabel(entry?.at ?? r.createdAt, lang, t)} tech={tech} setTech={setTech} openPublic={() => openLink(r.url)} />
    </Frame>
  );
}

function ReceiptBody({ r, when, tech, setTech, openPublic }: { r: Receipt; when: string; tech: boolean; setTech(v: boolean): void; openPublic(): void }) {
  const { t, lang } = useApp();
  const inn = BigInt(r.amountIn);
  const out = BigInt(r.amountOut);
  const offOut = r.savings ? out - BigInt(r.savings.deltaOut) : null;
  const gain = gainOf(r.savings);
  const status = r.status;
  const tone = status === "verified" ? { bg: "var(--save-bg)", fg: "var(--save-text)", icon: "✓" } : status === "registering" ? { bg: "var(--surface-2)", fg: "var(--text)", icon: "…" } : { bg: "var(--attention-bg)", fg: "var(--attention-text)", icon: "!" };
  const title = status === "verified" ? t.verified : status === "registering" ? t.registering : status === "mismatch" ? t.mismatch : t.rcFailed;
  const body = status === "verified" ? t.rcVerifiedB : status === "registering" ? t.rcRegisteringB : status === "mismatch" ? t.rcMismatchB : t.rcFailedB;
  return (
    <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
      {gain ? (
        <div className="mp-col" style={{ padding: "8px 4px" }}>
          <span style={{ fontSize: 16, color: "var(--muted)" }}>{t.rcSaved}</span>
          <span className="mp-amount mp-save" style={{ fontSize: 53, lineHeight: 1 }}>
            {fmtSaved(gain.deltaOut, r.to, lang)}
          </span>
          <span style={{ fontSize: 16, color: "var(--muted)" }}>
            {t.rcVsOff} · {when}
          </span>
        </div>
      ) : (
        <div className="mp-col" style={{ padding: "8px 4px" }}>
          <span className="mp-amount" style={{ fontSize: 41 }}>
            {fmtSym(out, r.to, lang)}
          </span>
          <span style={{ fontSize: 16, color: "var(--muted)" }}>{when}</span>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {(
          [
            [t.rcPaid, fmtSym(inn, r.from, lang)],
            [t.rcGot, fmtSym(out, r.to, lang)],
          ] as [string, string][]
        ).map(([k, v]) => (
          <div key={k} className="mp-soft mp-col">
            <span className="mp-meta">{k}</span>
            <span className="mp-tab" style={{ fontSize: 20, fontWeight: 800 }}>
              {v}
            </span>
          </div>
        ))}
      </div>
      <div className="mp-card pad">
        <span style={{ fontSize: 16, fontWeight: 700 }}>{t.rcCompare}</span>
        <div className="mp-col" style={{ gap: 5 }}>
          <div className="mp-between" style={{ fontSize: 15 }}>
            <span style={{ fontWeight: 700 }}>Arbolito</span>
            <span className="mp-mono">{fmtRateLine(rateString(inn, r.from, out, r.to), r.from, r.to, lang)}</span>
          </div>
          <div className="mp-meter" style={{ background: "var(--save-text)" }} />
        </div>
        {offOut !== null ? (
          <div className="mp-col" style={{ gap: 5 }}>
            <div className="mp-between" style={{ fontSize: 15, color: "var(--muted)" }}>
              <span>{t.rcOfficial}</span>
              <span className="mp-mono">{fmtRateLine(rateString(inn, r.from, offOut, r.to), r.from, r.to, lang)}</span>
            </div>
            <div className="mp-meter" style={{ width: `${out > 0n ? Math.min(100, Number((offOut * 1000n) / out) / 10) : 100}%`, background: "var(--muted)", opacity: 0.45 }} />
          </div>
        ) : null}
        <span className="mp-small">{r.savings ? fill(t.rcCompareNote, { p: fmtPct(r.savings.pct, lang) }) : t.rcNoSavings}</span>
      </div>
      <div className="mp-row" style={{ background: tone.bg, borderRadius: 18, padding: 16, gap: 14, alignItems: "flex-start" }} role="status">
        <span className="mp-circle" style={{ width: 40, height: 40, fontSize: 20, background: tone.fg, color: "var(--bg)" }}>
          {status === "registering" ? <Spinner size={18} color="var(--bg)" /> : tone.icon}
        </span>
        <span className="mp-col">
          <span style={{ fontSize: 17, fontWeight: 800, color: tone.fg }}>{title}</span>
          <span style={{ fontSize: 15, lineHeight: 1.45 }}>{body}</span>
          <button type="button" className="mp-link inline" style={{ alignSelf: "flex-start", minHeight: 40, color: tone.fg }} onClick={() => setTech(!tech)} aria-expanded={tech}>
            {tech ? t.rcTechHide : t.rcTechShow}
          </button>
        </span>
      </div>
      {tech ? (
        <div className="mp-tech">
          <span>
            {receiptRef(r.receiptId)} · {r.receiptId}
          </span>
          <span>
            {t.rcTx} · {shortHex(r.executionTx)}
          </span>
          {r.anchorTx ? (
            <span>
              {t.rcAnchor} · {shortHex(r.anchorTx)}
            </span>
          ) : null}
          <button type="button" className="mp-link inline" style={{ alignSelf: "flex-start", minHeight: 44 }} onClick={openPublic}>
            {t.rcPublic} ↗
          </button>
        </div>
      ) : null}
    </div>
  );
}
