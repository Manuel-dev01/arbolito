/**
 * Fair value for a corridor from independent sources: a weighted median, outliers dropped,
 * and a refusal (ok: false) when too few fresh sources agree. Pure; rates are fiat per USD.
 */
import type { Corridor, SourceId } from "./corridors";

export interface Observation {
  source: SourceId;
  /** Fiat units per 1 USD (e.g. 1612 ARS). */
  fiatPerUsd: number;
  /** When the source observed it (ms since epoch). */
  at: number;
}

export interface Dropped {
  source: SourceId;
  reason: "stale" | "invalid" | "outlier" | "missing";
  devBps?: number;
}

export type Fair =
  | { ok: true; fiatPerUsd: number; used: SourceId[]; dropped: Dropped[]; dispersionBps: number }
  | { ok: false; reason: string; used: SourceId[]; dropped: Dropped[] };

export const devBps = (a: number, b: number) => Math.abs(a / b - 1) * 10_000;

/** The value at which the cumulative weight first reaches half the total. */
export function weightedMedian(xs: { value: number; weight: number }[]): number {
  const sorted = xs.filter((x) => x.weight > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  for (const x of sorted) {
    acc += x.weight;
    if (acc >= total / 2) return x.value;
  }
  return NaN;
}

export function fairValue(c: Corridor, observations: Observation[], now: number): Fair {
  const dropped: Dropped[] = [];
  const fresh: { source: SourceId; value: number; weight: number }[] = [];
  for (const spec of c.sources) {
    const o = observations.find((x) => x.source === spec.id);
    if (!o) dropped.push({ source: spec.id, reason: "missing" });
    else if (!Number.isFinite(o.fiatPerUsd) || o.fiatPerUsd <= 0) dropped.push({ source: spec.id, reason: "invalid" });
    else if (now - o.at > spec.maxAgeMs) dropped.push({ source: spec.id, reason: "stale" });
    else fresh.push({ source: spec.id, value: o.fiatPerUsd, weight: spec.weight });
  }
  if (fresh.length < c.minSources) return { ok: false, reason: `only ${fresh.length} fresh source(s)`, used: fresh.map((f) => f.source), dropped };

  const m0 = weightedMedian(fresh);
  const kept = fresh.filter((f) => {
    const d = devBps(f.value, m0);
    if (d > c.maxDevBps) {
      dropped.push({ source: f.source, reason: "outlier", devBps: Math.round(d) });
      return false;
    }
    return true;
  });
  const used = kept.map((k) => k.source);
  if (kept.length < c.minSources) return { ok: false, reason: `sources disagree: ${kept.length} within ${c.maxDevBps} bps`, used, dropped };

  const fiatPerUsd = weightedMedian(kept);
  const dispersionBps = Math.round(Math.max(...kept.map((k) => devBps(k.value, fiatPerUsd))));
  return { ok: true, fiatPerUsd, used, dropped, dispersionBps };
}
