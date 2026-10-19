/**
 * Arbolito Desk data for /desk (server only): fills and inventory snapshots from Postgres
 * (written by apps/desk's ledger) plus the live feed's /state. Records are plain JSON (no bigint)
 * so they can sit in Next's data cache.
 */
import { asc, desc } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { loadEnv } from "@arbolito/config";
import { deskFills, deskSnapshots } from "@arbolito/db";
import { webDb } from "./data";

/** What the founder funded the desk with (40 USDT, 2026-10-15), micro-USD. */
export const DESK_CAPITAL_MICROS = 40_000_000n;

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

const loadDb = unstable_cache(
  async (): Promise<Omit<DeskView, "feed">> => {
    const db = webDb();
    if (!db) return { db: false, fills: [], latest: null, stats: deskStats([]) };
    const [rows, [latest]] = await Promise.all([
      db.select().from(deskFills).orderBy(asc(deskFills.at)),
      db.select().from(deskSnapshots).orderBy(desc(deskSnapshots.at)).limit(1),
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
    return { db: true, fills: fills.reverse(), latest: latest ? snap(latest) : null, stats: deskStats(fills) };
  },
  ["desk-db-v1"],
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
  return loadDb().catch(() => ({ db: false, fills: [], latest: null, stats: deskStats([]) }));
}

export async function loadDesk(): Promise<DeskView> {
  const [data, feed] = await Promise.all([loadDb().catch(() => ({ db: false, fills: [], latest: null, stats: deskStats([]) })), loadFeed()]);
  return { ...data, feed };
}
