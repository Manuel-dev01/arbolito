"use client";

import type { ReactNode } from "react";
import type { Cur } from "../../lib/miniapp/client/format";
import { GLYPH } from "../../lib/miniapp/client/format";
import type { Countdown } from "../../lib/miniapp/client/countdown";
import type { MiniDict } from "../../i18n/miniapp";
import { fill } from "../../i18n/miniapp";

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="28.5" y="34" width="7" height="24" rx="3.5" fill="var(--text)" />
      <circle cx="21" cy="31" r="11" fill="var(--a1)" />
      <circle cx="43" cy="31" r="11" fill="var(--a3)" />
      <circle cx="32" cy="17" r="12" fill="var(--a2)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="mp-row" style={{ gap: 10 }}>
      <Logo />
      <span style={{ fontFamily: "var(--fD)", fontSize: 34, letterSpacing: "-.02em" }}>
        arbolito<span className="mp-save">.</span>
      </span>
    </div>
  );
}

export function Spinner({ size = 16, color = "var(--save-text)" }: { size?: number; color?: string }) {
  return <span className="mp-spin" style={{ width: size, height: size, color }} aria-hidden="true" />;
}

export function Badge({ cur, size = 40 }: { cur: Cur; size?: number }) {
  return (
    <span className={`mp-badge ${cur}`} style={{ width: size, height: size }} aria-hidden="true">
      {GLYPH[cur]}
    </span>
  );
}

export type BtnKind = "primary" | "quiet" | "danger" | "busy" | "off";

export interface BtnSpec {
  label: string;
  onClick?: () => void;
  kind?: BtnKind;
}

export function Btn({ label, onClick, kind = "primary" }: BtnSpec) {
  const inert = kind === "busy" || kind === "off" || !onClick;
  return (
    <button type="button" className={`mp-btn ${kind === "primary" ? "" : kind}`} onClick={inert ? undefined : onClick} disabled={inert} aria-busy={kind === "busy" || undefined}>
      {kind === "busy" ? <Spinner size={18} color="currentColor" /> : null}
      <span>{label}</span>
    </button>
  );
}

/** Bottom action bar: optional note, one primary, one text secondary. */
export function ActionBar({ note, primary, secondary }: { note?: string; primary?: BtnSpec | null; secondary?: { label: string; onClick: () => void } | null }) {
  if (!primary && !secondary) return null;
  return (
    <div className="mp-actbar">
      {note ? <div className="mp-actbar-note">{note}</div> : null}
      {primary ? <Btn {...primary} /> : null}
      {secondary ? (
        <button type="button" className="mp-btn text" onClick={secondary.onClick}>
          {secondary.label}
        </button>
      ) : null}
    </div>
  );
}

export function Header({ title, step, onBack, backLabel }: { title: string; step?: string; onBack: () => void; backLabel: string }) {
  return (
    <div className="mp-header">
      <button type="button" className="mp-back" onClick={onBack} aria-label={backLabel}>
        ‹
      </button>
      <div className="mp-header-title">{title}</div>
      {step ? <div className="mp-header-step">{step}</div> : null}
    </div>
  );
}

export function Sheet({ onClose, children, label }: { onClose?: () => void; children: ReactNode; label: string }) {
  return (
    <div className="mp-overlay" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="mp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mp-grabber" />
        {children}
      </div>
    </div>
  );
}

export function NoMoneyMoved({ t }: { t: MiniDict }) {
  return <div className="mp-nomoney">{t.noMoneyMoved}</div>;
}

export function Switch({ on }: { on: boolean }) {
  return (
    <span className={`mp-switch ${on ? "on" : ""}`} aria-hidden="true">
      <span />
    </span>
  );
}

export function CountdownBar({ cd }: { cd: Countdown }) {
  return (
    <div className="mp-cd-track">
      <div className={`mp-cd-bar ${cd.phase}`} style={{ width: `${cd.fraction * 100}%` }} />
    </div>
  );
}

export function CountdownText({ cd, t }: { cd: Countdown; t: MiniDict }) {
  return (
    <span className={`mp-cd-text ${cd.phase}`} aria-live={cd.phase === "low" ? "polite" : "off"}>
      {cd.phase === "expired" ? t.expiredShort : fill(t.expiresIn, { s: cd.secs })}
    </span>
  );
}

export type ReceiptState = "registering" | "verified" | "mismatch" | "failed";

/** The three-state verification badge: Registrando → Verificado / No coincide. */
export function ReceiptBadge({ status, t }: { status: ReceiptState; t: MiniDict }) {
  if (status === "verified") return <span className="mp-tag save">✓ {t.verified}</span>;
  if (status === "mismatch") return <span className="mp-tag warn">! {t.mismatch}</span>;
  if (status === "failed") return <span className="mp-tag warn">✕ {t.rcFailed}</span>;
  return (
    <span className="mp-tag muted">
      <Spinner size={10} color="currentColor" /> {t.registering}
    </span>
  );
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="mp-kv">
      <span>{k}</span>
      <span>{children}</span>
    </div>
  );
}

/** Line icons (24×24, stroke = currentColor) for the home screen's actions and bars. */
const ICONS = {
  swap: "M7 7h11l-3-3M17 17H6l3 3",
  send: "M5 19 19 5M9 5h10v10",
  plus: "M12 5v14M5 12h14",
  withdraw: "M12 4v11m-4-4 4 4 4-4M5 19h14",
  mic: "M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3",
  spark: "M12 4l1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.3z",
  chevron: "M9 6l6 6-6 6",
} as const;

export function Icon({ name, size = 24, stroke = 2 }: { name: keyof typeof ICONS; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
