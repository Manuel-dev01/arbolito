import { z } from "zod";
import type { PublicClient } from "viem";
import { POOLS, TOKENS, loadEnv } from "@arbolito/config";
import { poolAbi } from "./abis";
import { fetchTextileTickers } from "./textile/tickers";
import type { Reference } from "./types";

/** 8 significant digits as a plain decimal (never "1e+26": receipts store rates as decimal strings). */
export const fmtRate = (n: number) => {
  const s = String(Number(n.toPrecision(8)));
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  // Shift the decimal point by the exponent on the digits themselves (toFixed also goes exponent past 1e21).
  const digits = m[2]! + (m[3] ?? "");
  const point = 1 + Number(m[4]);
  const plain =
    point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits + "0".repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return m[1] + plain;
};

/** price of token1 in token0 units, from a v3 sqrtPriceX96, decimal-adjusted. */
export function priceFromSqrtX96(sqrtPriceX96: bigint, dec0: number, dec1: number): number {
  const up = dec0 > dec1 ? dec0 - dec1 : 0;
  const down = dec1 > dec0 ? dec1 - dec0 : 0;
  const num = sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(36 + up);
  const den = (1n << 192n) * 10n ** BigInt(down);
  return Number(num / den) / 1e36;
}

const dolarSchema = z.array(
  z.object({ casa: z.string(), moneda: z.string(), compra: z.number().nullable(), venta: z.number().nullable(), fechaActualizacion: z.string() }),
);

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

/** Argentine USD rates (official, MEP, CCL, crypto, blue) as USD/ARS, using the "venta" side. */
export async function dolarRefs(timeoutMs = 1500): Promise<Reference[]> {
  const base = loadEnv().DOLAR_API_URL.replace(/\/$/, "");
  const url = `${base}/dolares`;
  const rows = dolarSchema.parse(await getJson(url, timeoutMs));
  const map: Record<string, Reference["name"]> = {
    oficial: "official",
    bolsa: "mep",
    contadoconliqui: "ccl",
    cripto: "crypto",
    blue: "blue",
  };
  return rows
    .filter((r) => r.moneda === "USD" && map[r.casa] && r.venta)
    .map((r) => ({ name: map[r.casa]!, pair: "USD/ARS", rate: fmtRate(r.venta!), source: `${url}#${r.casa}.venta`, at: r.fechaActualizacion }));
}

/** Official BRL/ARS cross from dolarapi /cotizaciones. */
export async function brlRefs(timeoutMs = 1500): Promise<Reference[]> {
  const base = loadEnv().DOLAR_API_URL.replace(/\/$/, "");
  const url = `${base}/cotizaciones`;
  const rows = dolarSchema.parse(await getJson(url, timeoutMs));
  const brl = rows.find((r) => r.moneda === "BRL" && r.casa === "oficial" && r.venta);
  return brl ? [{ name: "official", pair: "BRL/ARS", rate: fmtRate(brl.venta!), source: `${url}#BRL.oficial.venta`, at: brl.fechaActualizacion }] : [];
}

/** Uniswap pool mids for the ARS and BRL corridors, as USD/ARS and USD/BRL (USDT as USD). */
export async function uniswapRefs(client: PublicClient, blockNumber: bigint): Promise<Reference[]> {
  const wanted = POOLS.filter((p) => p.routable && (p.token0 === "wARS" || p.token1 === "wBRL"));
  const [slots, liquidity] = await Promise.all([
    client.multicall({ allowFailure: true, blockNumber, contracts: wanted.map((p) => ({ address: p.address, abi: poolAbi, functionName: "slot0" }) as const) }),
    client.multicall({ allowFailure: true, blockNumber, contracts: wanted.map((p) => ({ address: p.address, abi: poolAbi, functionName: "liquidity" }) as const) }),
  ]);
  const at = new Date().toISOString();
  const out: Reference[] = [];
  wanted.forEach((p, i) => {
    const s = slots[i];
    if (s?.status !== "success") return;
    // A drained pool sits at the min/max tick with no liquidity in range (wBRL/USDT, 2026-10-26:
    // tick 887271, "mid" 3.4e26): its price says nothing about the market, so it is no reference.
    const l = liquidity[i];
    if (l?.status !== "success" || l.result === 0n) return;
    const t0 = TOKENS[p.token0];
    const t1 = TOKENS[p.token1];
    const price1per0 = priceFromSqrtX96(s.result[0], t0.decimals, t1.decimals);
    // Express as USD/<fiat>: fiat units per 1 USDT.
    const [fiat, rate] = p.token0 === "USDT" ? [t1.symbol, price1per0] : [t0.symbol, 1 / price1per0];
    out.push({
      name: "uniswap_mid",
      pair: `USD/${fiat.replace(/^w/, "")}`,
      rate: fmtRate(rate),
      source: `uniswap-v3:${p.address}@${blockNumber}`,
      at,
    });
  });
  return out;
}

/** Textile ticker mids for the Celo LatAm corridors, as USD/ARS, USD/BRL, USD/COP and USD/MXN. */
export async function textileRefs(timeoutMs = 1500): Promise<Reference[]> {
  const t = await fetchTextileTickers(timeoutMs);
  if (!t) return [];
  return t.tickers
    .filter((x) => x.base === "USDT" && ["WARS", "WBRL", "WCOP", "WMXN"].includes(x.target))
    .map((x) => ({ name: "textile_mid", pair: `USD/${x.target.slice(1)}`, rate: fmtRate(x.mid), source: `${t.source}#${x.tickerId}`, at: t.at }));
}

const erApiSchema = z.object({ result: z.literal("success"), time_last_update_utc: z.string(), rates: z.record(z.string(), z.number()) });
const frankfurterSchema = z.object({ date: z.string(), rates: z.record(z.string(), z.number()) });

/**
 * Interbank (mid-market) references for the peso corridors without an Argentine-style official
 * rate here: USD/COP from ExchangeRate-API's open feed (daily; it asks for attribution where shown,
 * which the receipt's source link gives) and USD/MXN from the ECB via Frankfurter. Colombia's TRM
 * (datos.gov.co) refuses server requests, so nothing is labelled "official" for COP.
 */
export async function interbankRefs(timeoutMs = 1500): Promise<Reference[]> {
  const erUrl = "https://open.er-api.com/v6/latest/USD";
  const ecbUrl = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=MXN";
  const [er, ecb] = await Promise.allSettled([getJson(erUrl, timeoutMs), getJson(ecbUrl, timeoutMs)]);
  const out: Reference[] = [];
  const erParsed = er.status === "fulfilled" ? erApiSchema.safeParse(er.value) : null;
  if (erParsed?.success && erParsed.data.rates.COP) {
    out.push({ name: "interbank", pair: "USD/COP", rate: fmtRate(erParsed.data.rates.COP), source: `${erUrl}#COP`, at: new Date(erParsed.data.time_last_update_utc).toISOString() });
  }
  const ecbParsed = ecb.status === "fulfilled" ? frankfurterSchema.safeParse(ecb.value) : null;
  if (ecbParsed?.success && ecbParsed.data.rates.MXN) {
    out.push({ name: "interbank", pair: "USD/MXN", rate: fmtRate(ecbParsed.data.rates.MXN), source: `${ecbUrl}#MXN`, at: `${ecbParsed.data.date}T00:00:00.000Z` });
  }
  if (!out.length) throw new Error("no interbank source answered");
  return out;
}

/** Fiat code for a token: USD stables → "USD", wFIAT → the ISO code ("wBRL" → "BRL"). */
export function fiatOf(symbol: string): string {
  if (["USAT", "USDT", "USDC", "USDm"].includes(symbol)) return "USD";
  return symbol.replace(/^w/, "");
}

/**
 * Reference rate for BASE/QUOTE (QUOTE units per 1 BASE), using USD crosses when the
 * direct pair is missing: USD/X directly, or X/USD as 1 / (USD/X).
 */
export function referenceRate(refs: Reference[], name: Reference["name"], base: string, quote: string): number | undefined {
  const find = (pair: string) => {
    const hit = refs.find((r) => r.name === name && r.pair === pair);
    return hit ? Number(hit.rate) : undefined;
  };
  const direct = find(`${base}/${quote}`);
  if (direct) return direct;
  if (quote === "USD") {
    const inv = find(`USD/${base}`);
    return inv ? 1 / inv : undefined;
  }
  return undefined;
}

export interface RefsResult {
  references: Reference[];
  /** Sources that failed or timed out (shown, never fatal). */
  unavailable: string[];
}

/** All references in parallel; any source can fail without breaking the quote. */
export async function fetchReferences(client: PublicClient, blockNumber: bigint, timeoutMs = 1500): Promise<RefsResult> {
  const sources: [string, Promise<Reference[]>][] = [
    ["dolarapi /dolares", dolarRefs(timeoutMs)],
    ["dolarapi /cotizaciones", brlRefs(timeoutMs)],
    ["uniswap slot0", uniswapRefs(client, blockNumber)],
    ["textile /tickers", textileRefs(timeoutMs)],
    ["interbank (er-api, ecb)", interbankRefs(timeoutMs)],
  ];
  const settled = await Promise.allSettled(sources.map(([, p]) => p));
  const references: Reference[] = [];
  const unavailable: string[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled" && s.value.length) references.push(...s.value);
    else unavailable.push(sources[i]![0]);
  });
  return { references, unavailable };
}
