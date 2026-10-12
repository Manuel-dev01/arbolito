"use client";

import { useMemo, useState } from "react";
import { applyRate, formatFixed, type Locale } from "../../lib/format";
import { parseTyped } from "./parse-amount";
import type { CalcKey, CalcRows } from "./public-data";

export interface CalculatorLabels {
  pre: string;
  mid: string;
  more: string;
  less: string;
  have: string;
  usd: string;
  brl: string;
  amount: string;
  sources: string;
  rows: Record<CalcKey, string>;
}

type Cur = "USD" | "BRL";
const SYM: Record<Cur, string> = { USD: "US$", BRL: "R$" };
const PRESETS: Record<Cur, bigint[]> = { USD: [100n, 500n, 1_500n], BRL: [200n, 1_000n, 5_000n] };
const ONE = 10n ** 18n;
const DEC = 18;

const ars = (v: bigint, locale: Locale) => `ARS ${formatFixed(v, DEC, locale, { dp: 0 })}`;

export function Calculator({ locale, rows, labels, notes, initial = "USD" }: { locale: Locale; rows: CalcRows; labels: CalculatorLabels; notes: Record<Cur, string>; initial?: Cur }) {
  const available = (["USD", "BRL"] as Cur[]).filter((c) => rows[c].length > 0);
  const [cur, setCur] = useState<Cur>(available.includes(initial) ? initial : (available[0] ?? "USD"));
  const [raw, setRaw] = useState(() => formatFixed(500n * ONE, DEC, locale, { dp: 0 }));

  const amount = useMemo(() => parseTyped(raw, locale), [raw, locale]);
  const list = rows[cur];
  const view = useMemo(() => {
    const rates = list.map((r) => BigInt(r.rate));
    const max = rates.reduce((a, b) => (b > a ? b : a), 0n);
    const min = (rates.reduce((a, b) => (b < a ? b : a), max) * 9n) / 10n;
    const span = max - min;
    const out = list.map((r, i) => {
      const value = applyRate(amount, DEC, rates[i]!, DEC);
      const pct = span === 0n ? 100 : Number(((rates[i]! - min) * 10_000n) / span) / 100;
      return { ...r, value, pct };
    });
    const ours = out.find((r) => r.key === "arbolito");
    const official = out.find((r) => r.key === "official");
    return { out, ours, diff: ours && official ? ours.value - official.value : 0n };
  }, [list, amount]);

  if (available.length === 0) return null;
  const diffText = ars(view.diff < 0n ? -view.diff : view.diff, locale);
  const [before, after] = (view.diff < 0n ? labels.less : labels.more).split("{x}");

  return (
    <div className="calc-card card glass">
      <p className="calc-sentence" aria-live="polite">
        {labels.pre}{" "}
        <span className="calc-input">
          <span>{SYM[cur]}</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label={labels.amount}
            value={raw}
            onChange={(e) => setRaw(e.target.value.replace(/[^0-9.,]/g, "").slice(0, 12))}
            style={{ width: `${Math.max(2, raw.length) + 0.3}ch` }}
          />
        </span>{" "}
        {labels.mid} <span className="hl-lime nowrap">{view.ours ? ars(view.ours.value, locale) : "—"}</span>. {before}
        <span className={view.diff < 0n ? "nowrap" : "nowrap accent-pink"}>{diffText}</span>
        {after}
      </p>

      <div className="calc-controls">
        <span className="muted">{labels.have}</span>
        {available.map((c) => (
          <button key={c} type="button" className={cur === c ? "chip chip-on" : "chip"} aria-pressed={cur === c} onClick={() => setCur(c)}>
            {c === "USD" ? labels.usd : labels.brl}
          </button>
        ))}
        {PRESETS[cur].map((p) => {
          const v = formatFixed(p * ONE, DEC, locale, { dp: 0 });
          return (
            <button key={p.toString()} type="button" className="chip chip-mono" onClick={() => setRaw(v)}>
              {SYM[cur]} {v}
            </button>
          );
        })}
      </div>

      <ul className="bars">
        {view.out.map((r) => (
          <li key={r.key} className={r.key === "arbolito" ? "bar-row bar-me" : "bar-row"}>
            <span className="bar-label">{labels.rows[r.key]}</span>
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${r.pct}%` }} />
            </span>
            <span className="bar-value mono">{ars(r.value, locale)}</span>
          </li>
        ))}
      </ul>

      <p className="calc-note">{notes[cur]}</p>
      <details className="calc-sources">
        <summary>{labels.sources}</summary>
        <ul>
          {view.out.map((r) => (
            <li key={r.key}>
              {labels.rows[r.key]}:{" "}
              {r.source.startsWith("http") ? (
                <a href={r.source} target="_blank" rel="noopener noreferrer">
                  {r.source.replace(/^https?:\/\//, "")}
                </a>
              ) : (
                <span className="mono">{r.source}</span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
