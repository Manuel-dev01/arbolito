/**
 * Nigeria's official USD/NGN rate (Central Bank of Nigeria), read a few times a day and stored under
 * the rate's own date. The CBN's API returns its whole history (about 8 MB), too slow to call per quote.
 * Free and unpaid: no buy session involved. The web app uses a stored rate only while it is current.
 */
import { insertCompetitorRates, latestCompetitorRates, type Db } from "@arbolito/db";
import { log } from "@arbolito/chain";

export const CBN_URL = "https://www.cbn.gov.ng/api/GetAllExchangeRates";
const CHECK_MS = 6 * 3_600_000;
const STARTUP_DELAY_MS = 2 * 60_000;
const DAY_MS = 24 * 3_600_000;

export interface OfficialRate {
  /** The CBN's date for the rate, at 00:00 UTC. */
  at: Date;
  rate: string;
}

/** The newest US dollar rate in the CBN's answer; null when there is none that makes sense. */
export function latestCbnUsd(rows: unknown, now = Date.now()): OfficialRate | null {
  if (!Array.isArray(rows)) return null;
  let best: OfficialRate | null = null;
  for (const r of rows as { currency?: unknown; ratedate?: unknown; centralrate?: unknown }[]) {
    if (r?.currency !== "US DOLLAR" || typeof r.ratedate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.ratedate)) continue;
    const rate = String(r.centralrate);
    const n = Number(rate);
    const at = new Date(`${r.ratedate}T00:00:00.000Z`);
    if (!/^\d+(\.\d+)?$/.test(rate) || n < 100 || n > 20_000 || Number.isNaN(at.getTime()) || at.getTime() > now + DAY_MS) continue;
    if (!best || at > best.at) best = { at, rate };
  }
  return best;
}

/** Reads the CBN and stores its newest rate once. Returns what is new, or null. */
export async function refreshCbn(db: Db, f: typeof fetch = fetch): Promise<OfficialRate | null> {
  const [stored] = await latestCompetitorRates(db, "cbn", 30 * DAY_MS);
  const today = new Date().toISOString().slice(0, 10);
  if (stored && stored.at.toISOString().slice(0, 10) === today) return null;
  const res = await f(CBN_URL, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`CBN answered ${res.status}`);
  const latest = latestCbnUsd(await res.json());
  if (!latest) throw new Error("no usable US dollar rate in the CBN's answer");
  if (stored && latest.at <= stored.at) return null;
  // A day's move past 20% is a bad row far more often than news: leave it for a person to look at.
  if (stored && Math.abs(Number(latest.rate) / Number(stored.rate) - 1) > 0.2) throw new Error(`CBN rate jumped from ${stored.rate} to ${latest.rate}: not stored`);
  await insertCompetitorRates(db, [{ provider: "cbn", corridor: "USD-NGN", rate: latest.rate, sendAmount: "1", receiveAmount: latest.rate, sourceUrl: `${CBN_URL}#USD.centralrate`, at: latest.at }]);
  return latest;
}

export function startOfficialRatesRunner(db: Db): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await refreshCbn(db);
      if (r) log(`[official-rates] CBN USD/NGN ${r.rate} (${r.at.toISOString().slice(0, 10)})`);
    } catch (e) {
      log(`[official-rates] ${(e as Error).message}; next try in ${CHECK_MS / 3_600_000} h`);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(() => void tick(), STARTUP_DELAY_MS);
  const timer = setInterval(() => void tick(), CHECK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
