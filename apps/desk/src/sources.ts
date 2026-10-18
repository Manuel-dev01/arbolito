/**
 * Source fetchers for the desk feed. Free public reads only (Textile /price, dolarapi, Uniswap
 * slot0). Each returns Observations as fiat per USD; a failing source just returns nothing, and
 * fair.ts treats it as missing.
 */
import { z } from "zod";
import type { PublicClient } from "viem";
import { loadEnv } from "@arbolito/config";
import { uniswapRefs } from "@arbolito/router";
import type { Corridor, SourceId } from "./corridors";
import type { Observation } from "./fair";

const TIMEOUT_MS = 6_000; // within the 10 s tick; slow links (and cold DNS) need the room

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

// usat-usdt answers without chainId (and with source/unit), so chainId is optional.
const textilePrice = z.object({ pair: z.string(), chainId: z.number().optional(), price: z.number().positive(), timestamp: z.number() });

/** Textile's corridor price (USDT per soft) → fiat per USD. */
export async function fetchTextile(pair: Corridor["pair"]): Promise<Observation[]> {
  const base = loadEnv().TEXTILE_PUBLIC_BASE.replace(/\/$/, "");
  const p = textilePrice.parse(await getJson(`${base}/price?chainId=42220&pair=${pair}`));
  return [{ source: "textile_price", fiatPerUsd: 1 / p.price, at: p.timestamp * 1000 }];
}

const dolarRows = z.array(z.object({ casa: z.string(), moneda: z.string(), compra: z.number().nullable(), venta: z.number().nullable(), fechaActualizacion: z.string() }));
type DolarRow = z.infer<typeof dolarRows>[number];
const mid = (r: DolarRow) => (r.compra && r.venta ? (r.compra + r.venta) / 2 : (r.venta ?? r.compra ?? NaN));

/** dolarapi: cripto and CCL (USD/ARS), and the official USD/BRL cross via ARS. */
export async function fetchDolar(): Promise<Observation[]> {
  const base = loadEnv().DOLAR_API_URL.replace(/\/$/, "");
  const [dolares, cotizaciones] = await Promise.all([
    getJson(`${base}/dolares`).then((j) => dolarRows.parse(j)),
    getJson(`${base}/cotizaciones`).then((j) => dolarRows.parse(j)).catch(() => [] as DolarRow[]),
  ]);
  const out: Observation[] = [];
  const usd = (casa: string) => dolares.find((r) => r.moneda === "USD" && r.casa === casa);
  const push = (source: SourceId, r: DolarRow | undefined, value?: number) => {
    if (!r) return;
    out.push({ source, fiatPerUsd: value ?? mid(r), at: Date.parse(r.fechaActualizacion) });
  };
  push("dolar_crypto", usd("cripto"));
  push("dolar_ccl", usd("contadoconliqui"));
  const offUsd = usd("oficial");
  const offBrl = cotizaciones.find((r) => r.moneda === "BRL" && r.casa === "oficial");
  if (offUsd && offBrl) {
    // ARS per USD ÷ ARS per BRL = BRL per USD; timestamped by the older of the two.
    const older = Date.parse(offUsd.fechaActualizacion) < Date.parse(offBrl.fechaActualizacion) ? offUsd : offBrl;
    push("dolar_official_cross", older, mid(offUsd) / mid(offBrl));
  }
  return out.filter((o) => Number.isFinite(o.at));
}

const tickerRows = z.array(z.object({ ticker_id: z.string(), last_price: z.string(), bid: z.string(), ask: z.string() }));

/** Textile /tickers maker levels for USDT_<fiat>: the mid when both sides quote, else the quoted side or last. */
export async function fetchTextileTickers(): Promise<Map<string, Observation>> {
  const base = loadEnv().TEXTILE_PUBLIC_BASE.replace(/\/$/, "");
  const raw = (await getJson(`${base}/tickers`)) as unknown;
  const rows = tickerRows.parse(Array.isArray(raw) ? raw : ((raw as { data?: unknown }).data ?? []));
  const now = Date.now();
  const out = new Map<string, Observation>();
  for (const r of rows) {
    const m = /^USDT_([A-Z]{3})$/.exec(r.ticker_id);
    if (!m) continue;
    const bid = Number(r.bid);
    const ask = Number(r.ask);
    const v = bid > 0 && ask > 0 ? (bid + ask) / 2 : ask > 0 ? ask : bid > 0 ? bid : Number(r.last_price);
    if (v > 0) out.set(m[1]!, { source: "textile_ticker", fiatPerUsd: v, at: now });
  }
  return out;
}

const erApi = z.object({ result: z.literal("success"), time_last_update_unix: z.number(), rates: z.record(z.string(), z.number()) });

/** ExchangeRate-API open access: daily USD rates (attribution required wherever shown). */
export async function fetchErApi(): Promise<Map<string, Observation>> {
  const j = erApi.parse(await getJson("https://open.er-api.com/v6/latest/USD"));
  const at = j.time_last_update_unix * 1000;
  return new Map(Object.entries(j.rates).map(([k, v]) => [k, { source: "er_api" as const, fiatPerUsd: v, at }]));
}

const frankfurter = z.object({ date: z.string(), rates: z.record(z.string(), z.number()) });

/** ECB reference rates via Frankfurter (published ~16:00 CET on business days). */
export async function fetchEcb(symbols: string[]): Promise<Map<string, Observation>> {
  const j = frankfurter.parse(await getJson(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${symbols.join(",")}`));
  const at = Date.parse(`${j.date}T15:00:00Z`);
  return new Map(Object.entries(j.rates).map(([k, v]) => [k, { source: "ecb" as const, fiatPerUsd: v, at }]));
}

/** Celo Uniswap v3 pool mids (USD/ARS, USD/BRL), observed now. */
export async function fetchUniswap(client: PublicClient): Promise<Map<string, Observation>> {
  const block = await client.getBlockNumber();
  const refs = await uniswapRefs(client, block);
  const now = Date.now();
  const byFiat = new Map<string, Observation>();
  for (const r of refs) byFiat.set(r.pair.replace("USD/", ""), { source: "uniswap_mid", fiatPerUsd: Number(r.rate), at: now });
  return byFiat;
}

/** Every source for every corridor in one round; failures become absences, with the reason kept. */
export async function observeAll(client: PublicClient, corridors: readonly Corridor[]): Promise<{ byPair: Map<string, Observation[]>; errors: string[] }> {
  const errors: string[] = [];
  const safe = async <T>(label: string, p: Promise<T>, empty: T): Promise<T> => {
    try {
      return await p;
    } catch (e) {
      errors.push(`${label}: ${(e as Error).message}`);
      return empty;
    }
  };
  const uses = (id: SourceId) => corridors.some((c) => c.sources.some((s) => s.id === id));
  const none = new Map<string, Observation>();
  const ecbSymbols = corridors.filter((c) => c.sources.some((s) => s.id === "ecb")).map((c) => c.fiat);
  const [dolar, uni, tickers, er, ecb, ...textile] = await Promise.all([
    safe("dolarapi", fetchDolar(), [] as Observation[]),
    safe("uniswap", fetchUniswap(client), new Map<string, Observation>()),
    uses("textile_ticker") ? safe("textile tickers", fetchTextileTickers(), none) : none,
    uses("er_api") ? safe("er-api", fetchErApi(), none) : none,
    ecbSymbols.length ? safe("ecb", fetchEcb(ecbSymbols), none) : none,
    ...corridors.map((c) =>
      c.sources.some((s) => s.id === "textile_price") ? safe(`textile ${c.pair}`, fetchTextile(c.pair), [] as Observation[]) : Promise.resolve([] as Observation[]),
    ),
  ]);
  const byPair = new Map<string, Observation[]>();
  corridors.forEach((c, i) => {
    const obs = [...textile[i]!, ...dolar.filter((o) => c.sources.some((s) => s.id === o.source))];
    const u = c.fiat === "USD" ? undefined : uni.get(c.fiat);
    if (u) obs.push(u);
    if (c.sources.some((s) => s.id === "peg")) obs.push({ source: "peg", fiatPerUsd: 1, at: Date.now() });
    for (const [id, m] of [["textile_ticker", tickers], ["er_api", er], ["ecb", ecb]] as const) {
      const o = m.get(c.fiat);
      if (o && c.sources.some((s) => s.id === id)) obs.push(o);
    }
    byPair.set(c.pair, obs);
  });
  return { byPair, errors };
}
