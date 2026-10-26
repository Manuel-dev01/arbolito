/**
 * Arbolito Desk data for /desk (server only): fills and inventory snapshots from Postgres
 * (written by apps/desk's ledger) plus the live feed's /state. Records are plain JSON (no bigint)
 * so they can sit in Next's data cache.
 */
import { asc, count, desc, gte } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { loadEnv } from "@arbolito/config";
import { deskFills, deskRfqs, deskSnapshots } from "@arbolito/db";
import { webDb } from "./data";

/**
 * What the founder funded the desk with, micro-USD: three deposits of 40 USDT from 0x7769…a734
 * (blocks 80170952, 80313359 and 80404036; checked onchain 2026-10-20), plus 40 USDT from ops on
 * 2026-10-26 (docs/TREASURY.md). Gas CELO from ops excluded. Update with every deposit.
 */
export const DESK_CAPITAL_MICROS = 160_000_000n;

const DAY = 86_400_000;

/** Share of snapshots (every ~5 min) in which each corridor was quoting, over the last day and week. */
export type Uptime = Record<string, { day: number | null; week: number | null }>;

/** Pure: uptime per pair from snapshots' `quoting` maps (rows without one are skipped). */
export function uptimeFrom(rows: { at: Date; quoting: unknown }[], now: number): Uptime {
  const acc: Record<string, { d: [number, number]; w: [number, number] }> = {};
  for (const r of rows) {
    const q = r.quoting as Record<string, boolean> | null;
    if (!q) continue;
    const age = now - r.at.getTime();
    if (age > 7 * DAY) continue;
    for (const [pair, live] of Object.entries(q)) {
      const a = (acc[pair] ??= { d: [0, 0], w: [0, 0] });
      a.w[1]++;
      if (live) a.w[0]++;
      if (age <= DAY) {
        a.d[1]++;
        if (live) a.d[0]++;
      }
    }
  }
  const out: Uptime = {};
  for (const [pair, a] of Object.entries(acc)) out[pair] = { day: a.d[1] ? a.d[0] / a.d[1] : null, week: a.w[1] ? a.w[0] / a.w[1] : null };
  return out;
}

export interface DeskFillRecord {
  txHash: string;
  at: string;
  pair: string;
  side: "buy" | "sell";
  softAmount: string;
  usdtAmount: string;
  price: number;
  fairPrice: number | null;
  edgeBps: number | null;
}

export interface DeskSnapshotRecord {
  at: string;
  usdt: string;
  wars: string;
  wbrl: string;
  usdc: string | null;
  usat: string | null;
  /** Fair USDT per soft unit by pair (newer rows); older rows only have fairWars/fairWbrl. */
  fairs: Record<string, number>;
  /** Every token balance by symbol (newer rows). */
  balances: Record<string, string>;
  fairWars: number | null;
  fairWbrl: number | null;
  navMicros: string | null;
}

export interface FeedCorridor {
  pair: string;
  params: { live?: boolean; buyOffsetBps: number; sellOffsetBps: number };
  served: { price: number; timestamp: number } | null;
  decisions: { action: "publish" | "hold"; reason?: string; fiatPerUsd?: number; skewBps?: number; used: string[]; at: string }[];
}

export interface FeedState {
  lastTickAt: string | null;
  corridors: FeedCorridor[];
}

export interface DeskStats {
  fills: number;
  /** USDT volume, micro-USD. */
  volumeMicros: string;
  /** Σ edge × notional over fills with a recorded fair price, micro-USD (signed). */
  spreadMicros: string;
}

export interface DeskView {
  db: boolean;
  uptime: Uptime;
  /** RFQs our quote won, as Stitch logged them (since 2026-10-20). */
  rfqsWon: number;
  fills: DeskFillRecord[];
  latest: DeskSnapshotRecord | null;
  stats: DeskStats;
  feed: FeedState | null;
}

const snap = (r: typeof deskSnapshots.$inferSelect): DeskSnapshotRecord => ({
  at: r.at.toISOString(),
  usdt: r.usdt,
  wars: r.wars,
  wbrl: r.wbrl,
  usdc: r.usdc,
  usat: r.usat,
  fairs: (r.fairs as Record<string, number> | null) ?? {},
  balances: (r.balances as Record<string, string> | null) ?? {},
  fairWars: r.fairWars === null ? null : Number(r.fairWars),
  fairWbrl: r.fairWbrl === null ? null : Number(r.fairWbrl),
  navMicros: r.navMicros,
});

/** Pure: stats from the full fill list. */
export function deskStats(fills: DeskFillRecord[]): DeskStats {
  let volume = 0n;
  let spread = 0;
  for (const f of fills) {
    volume += BigInt(f.usdtAmount);
    if (f.edgeBps !== null) spread += (Number(f.usdtAmount) * f.edgeBps) / 10_000;
  }
  return { fills: fills.length, volumeMicros: volume.toString(), spreadMicros: Math.round(spread).toString() };
}

const EMPTY: Omit<DeskView, "feed"> = { db: false, fills: [], latest: null, stats: deskStats([]), uptime: {}, rfqsWon: 0 };

const loadDb = unstable_cache(
  async (): Promise<Omit<DeskView, "feed">> => {
    const db = webDb();
    if (!db) return EMPTY;
    const now = Date.now();
    const [rows, [latest], recent, [won]] = await Promise.all([
      db.select().from(deskFills).orderBy(asc(deskFills.at)),
      db.select().from(deskSnapshots).orderBy(desc(deskSnapshots.at)).limit(1),
      db.select({ at: deskSnapshots.at, quoting: deskSnapshots.quoting }).from(deskSnapshots).where(gte(deskSnapshots.at, new Date(now - 7 * DAY))),
      db.select({ n: count() }).from(deskRfqs),
    ]);
    const fills: DeskFillRecord[] = rows.map((r) => ({
      txHash: r.txHash,
      at: r.at.toISOString(),
      pair: r.pair,
      side: r.side === "buy" ? "buy" : "sell",
      softAmount: r.softAmount,
      usdtAmount: r.usdtAmount,
      price: Number(r.price),
      fairPrice: r.fairPrice === null ? null : Number(r.fairPrice),
      edgeBps: r.edgeBps === null ? null : Number(r.edgeBps),
    }));
    return { db: true, fills: fills.reverse(), latest: latest ? snap(latest) : null, stats: deskStats(fills), uptime: uptimeFrom(recent, now), rfqsWon: won?.n ?? 0 };
  },
  ["desk-db-v2"],
  { revalidate: 30 },
);

async function loadFeed(): Promise<FeedState | null> {
  try {
    const res = await fetch(`${loadEnv().DESK_FEED_PUBLIC_URL.replace(/\/$/, "")}/state`, { signal: AbortSignal.timeout(4_000), next: { revalidate: 15 } });
    if (!res.ok) return null;
    return (await res.json()) as FeedState;
  } catch {
    return null;
  }
}

/** Fills and snapshots only (no feed call), for pages that must not wait on the feed. */
export async function loadDeskData(): Promise<Omit<DeskView, "feed">> {
  return loadDb().catch(() => EMPTY);
}

export async function loadDesk(): Promise<DeskView> {
  const [data, feed] = await Promise.all([loadDb().catch(() => EMPTY), loadFeed()]);
  return { ...data, feed };
}
