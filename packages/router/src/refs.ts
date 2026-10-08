import { z } from "zod";
import type { PublicClient } from "viem";
import { POOLS, TOKENS, loadEnv } from "@arbolito/config";
import { poolAbi } from "./abis";
import { fetchTextileTickers } from "./textile/tickers";
import type { Reference } from "./types";

const fmtRate = (n: number) => String(Number(n.toPrecision(8)));

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
  const slots = await client.multicall({
    allowFailure: true,
    blockNumber,
    contracts: wanted.map((p) => ({ address: p.address, abi: poolAbi, functionName: "slot0" }) as const),
  });
  const at = new Date().toISOString();
  const out: Reference[] = [];
  wanted.forEach((p, i) => {
    const s = slots[i];
    if (s?.status !== "success") return;
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

/** Textile ticker mids for the Celo LatAm corridors, as USD/ARS and USD/BRL. */
export async function textileRefs(timeoutMs = 1500): Promise<Reference[]> {
  const t = await fetchTextileTickers(timeoutMs);
  if (!t) return [];
  return t.tickers
    .filter((x) => x.base === "USDT" && (x.target === "WARS" || x.target === "WBRL"))
    .map((x) => ({ name: "textile_mid", pair: `USD/${x.target.slice(1)}`, rate: fmtRate(x.mid), source: `${t.source}#${x.tickerId}`, at: t.at }));
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
