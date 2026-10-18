/**
 * Arbolito Desk corridors: everything the strategy needs per pair, in one place.
 *
 * Stitch quotes RFQs off our feed's mid with fixed side spreads (buy/sellOffsetBps) and fixed
 * side caps. The feed carries the strategy (docs/10-desk-plan.md): a multi-source fair value,
 * an inventory skew on the mid, and a circuit breaker. The skew moves the mid, so each direction
 * is capped by the spread on the side it moves toward fair, minus a floor: no quote crosses fair.
 *
 * Spreads: Stitch's own Celo templates quote ±1 bps around Textile's price, which is what the
 * fixed-spread fillers we're judged against run, so ours start in single digits. wARS is
 * asymmetric on purpose: the peso crawls ~1–2%/month, so holding wARS costs a few bps a day.
 * We bid wider than we ask and aim to hold less wARS (targetShare 0.3). These are starting
 * points to tune once live RFQ flow is visible.
 *
 * Caps (founder-approved): US$ 10 per side per corridor from 2026-10-15; wBRL buy side US$ 20 and
 * the USDC/USDT and USA₮/USDT corridors from 2026-10-17 (another 40 USDT). Larger caps need approval.
 *
 * Stable corridors (USDC, USA₮ vs USDT) price off Textile with a fixed 1.00 peg as the second
 * source: if a stablecoin drifts more than maxDevBps off its peg the sources disagree and the
 * breaker stops quoting it, which doubles as a depeg guard.
 */
import { TOKENS } from "@arbolito/config";

export type Pair = "wars-usdt" | "wbrl-usdt" | "usdc-usdt" | "usat-usdt" | "wcop-usdt" | "wmxn-usdt";

export type SourceId =
  | "textile_price" // Textile's own corridor price (what other fillers price off)
  | "uniswap_mid" // Celo Uniswap v3 pool mid (thin: low weight, mainly an alarm)
  | "dolar_crypto" // dolarapi "cripto" USD/ARS (where wARS actually trades)
  | "dolar_ccl" // dolarapi CCL USD/ARS
  | "dolar_official_cross" // dolarapi official USD/ARS ÷ BRL/ARS → USD/BRL
  | "peg" // a stablecoin's 1.00 peg (stable corridors only)
  | "textile_ticker" // Textile /tickers maker levels (USDT_COP, USDT_MXN): mid, or the one side quoted
  | "er_api" // ExchangeRate-API open access (open.er-api.com), daily; attribution required when shown
  | "ecb"; // ECB reference rate via Frankfurter (MXN; no COP)

export interface SourceSpec {
  id: SourceId;
  /** Weight in the median. */
  weight: number;
  /** Older observations are ignored. */
  maxAgeMs: number;
}

export interface Corridor {
  pair: Pair;
  soft: "wARS" | "wBRL" | "USDC" | "USAT" | "wCOP" | "wMXN";
  fiat: "ARS" | "BRL" | "USD" | "COP" | "MXN";
  /** Stitch quotes it (inventory funded). A non-live corridor is priced and published only, to watch the feed before funding. */
  live: boolean;
  /** Stitch side spreads around our published mid. */
  buyOffsetBps: number;
  sellOffsetBps: number;
  /** Fixed RFQ caps per side, in atomic units. Never "max" (it double-books shared USDT). */
  buyCapUsdt: bigint;
  sellCapSoft: bigint;
  sources: SourceSpec[];
  /** Fewer agreeing sources than this → breaker holds (Stitch stops quoting once stale). */
  minSources: number;
  /** A source further than this from the weighted median is dropped as an outlier. */
  maxDevBps: number;
  /** A fair-value move larger than this in one tick is held until it persists for jumpConfirmMs. */
  jumpBps: number;
  jumpConfirmMs: number;
  skew: {
    /** Target share of the corridor's value held in the soft asset (0..1). */
    targetShare: number;
    /** Share distance from target at which the skew saturates. */
    bandShare: number;
    /** Largest mid shift, bps (further capped per direction by spread − floor). */
    maxBps: number;
    /** The tightest honest margin vs fair after skew, bps. */
    floorBps: number;
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const usdt = (n: number) => BigInt(Math.round(n * 1e6));
const wad = (n: number) => BigInt(Math.round(n)) * 10n ** 18n;
const usd6 = usdt;

export const CORRIDORS: readonly Corridor[] = [
  {
    pair: "wars-usdt",
    soft: "wARS",
    fiat: "ARS",
    live: true,
    buyOffsetBps: 14, // covers ~a day of peso crawl on what we buy
    sellOffsetBps: 5,
    buyCapUsdt: usdt(10),
    sellCapSoft: wad(16_000), // ≈ US$ 10 at ~1,600 ARS/USD
    sources: [
      { id: "textile_price", weight: 3, maxAgeMs: 10 * MIN },
      // dolarapi refreshes in Argentine market hours only; overnight it is ~14 h old. The peso
      // crawls ~5 bps a day, so a day-old print still cross-checks; outliers are dropped anyway.
      { id: "dolar_crypto", weight: 1, maxAgeMs: 26 * HOUR },
      { id: "dolar_ccl", weight: 1, maxAgeMs: 26 * HOUR },
      { id: "uniswap_mid", weight: 1, maxAgeMs: 5 * MIN },
    ],
    minSources: 2,
    maxDevBps: 120,
    jumpBps: 80,
    jumpConfirmMs: 30_000,
    skew: { targetShare: 0.3, bandShare: 0.3, maxBps: 10, floorBps: 2 },
  },
  {
    pair: "wbrl-usdt",
    soft: "wBRL",
    fiat: "BRL",
    live: true,
    buyOffsetBps: 6,
    sellOffsetBps: 6,
    buyCapUsdt: usdt(20), // raised 2026-10-17 to rebuild wBRL with idle USDT (founder OK)
    sellCapSoft: wad(50), // ≈ US$ 10 at ~5.05 BRL/USD
    sources: [
      { id: "textile_price", weight: 3, maxAgeMs: 10 * MIN },
      { id: "dolar_official_cross", weight: 1, maxAgeMs: 26 * HOUR },
      { id: "uniswap_mid", weight: 1, maxAgeMs: 5 * MIN },
    ],
    minSources: 2,
    maxDevBps: 150,
    jumpBps: 80,
    jumpConfirmMs: 30_000,
    skew: { targetShare: 0.5, bandShare: 0.35, maxBps: 4, floorBps: 2 },
  },
  ...(["USDC", "USAT"] as const).map(
    (soft): Corridor => ({
      pair: soft === "USDC" ? "usdc-usdt" : "usat-usdt",
      soft,
      fiat: "USD",
      live: true,
      buyOffsetBps: 3,
      sellOffsetBps: 3,
      buyCapUsdt: usdt(10),
      sellCapSoft: usd6(10),
      sources: [
        { id: "textile_price", weight: 3, maxAgeMs: 10 * MIN },
        { id: "peg", weight: 1, maxAgeMs: MIN },
      ],
      minSources: 2,
      maxDevBps: 30, // depeg guard
      jumpBps: 20,
      jumpConfirmMs: 30_000,
      skew: { targetShare: 0.5, bandShare: 0.35, maxBps: 2, floorBps: 1 },
    }),
  ),
  // Ripio wFIAT for Colombia and Mexico. No Uniswap pool and no Textile /price for these yet, so
  // fair comes from Textile's ticker levels and daily FX references. Not live until funded.
  {
    pair: "wcop-usdt",
    soft: "wCOP",
    fiat: "COP",
    live: false,
    buyOffsetBps: 10,
    sellOffsetBps: 10,
    buyCapUsdt: usdt(10),
    sellCapSoft: wad(31_700), // ≈ US$ 10 at ~3,170 COP/USD
    sources: [
      { id: "textile_ticker", weight: 2, maxAgeMs: 10 * MIN },
      { id: "er_api", weight: 1, maxAgeMs: 26 * HOUR },
    ],
    minSources: 2,
    maxDevBps: 150,
    jumpBps: 100,
    jumpConfirmMs: 30_000,
    skew: { targetShare: 0.5, bandShare: 0.35, maxBps: 6, floorBps: 3 },
  },
  {
    pair: "wmxn-usdt",
    soft: "wMXN",
    fiat: "MXN",
    live: false,
    buyOffsetBps: 10,
    sellOffsetBps: 10,
    buyCapUsdt: usdt(10),
    sellCapSoft: wad(185), // ≈ US$ 10 at ~18.5 MXN/USD
    sources: [
      { id: "textile_ticker", weight: 2, maxAgeMs: 10 * MIN },
      { id: "er_api", weight: 1, maxAgeMs: 26 * HOUR },
      { id: "ecb", weight: 1, maxAgeMs: 4 * 24 * HOUR }, // the ECB skips weekends and holidays
    ],
    minSources: 2,
    maxDevBps: 150,
    jumpBps: 100,
    jumpConfirmMs: 30_000,
    skew: { targetShare: 0.5, bandShare: 0.35, maxBps: 6, floorBps: 3 },
  },
];

/** The corridors Stitch quotes (funded). */
export const LIVE_CORRIDORS = CORRIDORS.filter((c) => c.live);

/** Problems with a corridor's parameters; empty when it is safe to run. */
export function validateCorridor(c: Corridor): string[] {
  const errs: string[] = [];
  if (c.skew.floorBps < 0 || c.buyOffsetBps < c.skew.floorBps || c.sellOffsetBps < c.skew.floorBps)
    errs.push(`${c.pair}: both spreads must be at least skew.floorBps (${c.skew.floorBps}), or a quote could cross fair`);
  if (c.skew.maxBps < 0) errs.push(`${c.pair}: skew.maxBps must be >= 0`);
  if (c.skew.targetShare <= 0 || c.skew.targetShare >= 1) errs.push(`${c.pair}: skew.targetShare must be in (0, 1)`);
  if (c.skew.bandShare <= 0) errs.push(`${c.pair}: skew.bandShare must be > 0`);
  if (c.buyCapUsdt <= 0n || c.sellCapSoft <= 0n) errs.push(`${c.pair}: side caps must be positive and fixed`);
  if (c.minSources < 2) errs.push(`${c.pair}: minSources must be at least 2 (one source can't be cross-checked)`);
  if (c.sources.reduce((n, s) => n + (s.weight > 0 ? 1 : 0), 0) < c.minSources) errs.push(`${c.pair}: fewer weighted sources than minSources`);
  const dec = TOKENS[c.soft].decimals;
  if ((c.fiat === "USD" ? dec !== 6 : dec !== 18) || TOKENS.USDT.decimals !== 6) errs.push(`${c.pair}: unexpected token decimals`);
  return errs;
}

export function corridor(pair: string): Corridor | undefined {
  return CORRIDORS.find((c) => c.pair === pair);
}
