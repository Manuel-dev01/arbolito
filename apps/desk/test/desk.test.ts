import { describe, expect, it } from "vitest";
import { TOKENS } from "@arbolito/config";
import {
  CORRIDORS,
  corridor,
  corridorShares,
  fairValue,
  publishedPrice,
  skewBps,
  step,
  stitchToml,
  validateCorridor,
  weightedMedian,
  type Corridor,
  type FeedState,
  type Observation,
} from "../src";

const ars = corridor("wars-usdt")!;
const brl = corridor("wbrl-usdt")!;
const NOW = Date.parse("2026-10-15T12:00:00Z");
const obs = (source: Observation["source"], fiatPerUsd: number, ageMs = 0): Observation => ({ source, fiatPerUsd, at: NOW - ageMs });

describe("corridor config", () => {
  it("ships safe parameters", () => {
    for (const c of CORRIDORS) expect(validateCorridor(c)).toEqual([]);
  });

  it("rejects a spread tighter than the floor (a quote could cross fair)", () => {
    const bad: Corridor = { ...ars, sellOffsetBps: 1, skew: { ...ars.skew, floorBps: 2 } };
    expect(validateCorridor(bad).join()).toMatch(/cross fair/);
  });

  it("rejects a single-source corridor", () => {
    expect(validateCorridor({ ...ars, minSources: 1 }).join()).toMatch(/minSources/);
  });
});

describe("fair value", () => {
  it("weighted median picks the value where half the weight is reached", () => {
    expect(weightedMedian([{ value: 1, weight: 1 }, { value: 2, weight: 3 }, { value: 3, weight: 1 }])).toBe(2);
    expect(weightedMedian([{ value: 10, weight: 1 }, { value: 20, weight: 1 }])).toBe(10);
  });

  it("uses agreeing fresh sources and drops an outlier", () => {
    const f = fairValue(ars, [obs("textile_price", 1612), obs("dolar_crypto", 1614), obs("dolar_ccl", 1616), obs("uniswap_mid", 1700)], NOW);
    expect(f.ok).toBe(true);
    if (!f.ok) return;
    expect(f.fiatPerUsd).toBe(1612);
    expect(f.used).not.toContain("uniswap_mid");
    expect(f.dropped).toContainEqual(expect.objectContaining({ source: "uniswap_mid", reason: "outlier" }));
    expect(f.dispersionBps).toBeLessThan(ars.maxDevBps);
  });

  it("refuses when too few sources are fresh", () => {
    const f = fairValue(ars, [obs("textile_price", 1612), obs("uniswap_mid", 1610, 10 * 60_000)], NOW);
    expect(f.ok).toBe(false);
    expect(f.dropped).toContainEqual({ source: "uniswap_mid", reason: "stale" });
  });

  it("refuses when sources disagree", () => {
    const f = fairValue(brl, [obs("textile_price", 5.05), obs("dolar_official_cross", 5.6), obs("uniswap_mid", 4.6)], NOW);
    expect(f.ok).toBe(false);
  });

  it("ignores invalid prints", () => {
    const f = fairValue(brl, [obs("textile_price", 0), obs("dolar_official_cross", NaN), obs("uniswap_mid", 5.03)], NOW);
    expect(f.ok).toBe(false);
    expect(f.dropped.filter((d) => d.reason === "invalid")).toHaveLength(2);
  });
});

describe("inventory skew", () => {
  it("shades the mid down when long the soft asset and up when short", () => {
    expect(skewBps(0.9, ars)).toBeLessThan(0);
    expect(skewBps(0.0, ars)).toBeGreaterThan(0);
    expect(skewBps(ars.skew.targetShare, ars)).toBe(0);
    expect(skewBps(undefined, ars)).toBe(0);
  });

  it("never shades past a spread minus the floor (no quote crosses fair)", () => {
    for (const c of CORRIDORS)
      for (const share of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
        const s = skewBps(share, c);
        expect(-s).toBeLessThanOrEqual(c.sellOffsetBps - c.skew.floorBps);
        expect(s).toBeLessThanOrEqual(c.buyOffsetBps - c.skew.floorBps);
        // The ask (mid shaded, plus the sell spread) stays at or above fair; the bid at or below.
        const fair = 1 / 1600;
        const mid = publishedPrice(1600, s);
        expect(mid * (1 + c.sellOffsetBps / 1e4)).toBeGreaterThanOrEqual(fair);
        expect(mid * (1 - c.buyOffsetBps / 1e4)).toBeLessThanOrEqual(fair);
      }
  });

  it("publishes USDT per soft unit (Stitch's debt per collateral)", () => {
    expect(publishedPrice(1600, 0)).toBeCloseTo(0.000625, 9);
  });

  it("splits shared USDT by buy cap and values the soft side at fair", () => {
    const shares = corridorShares(
      { USDT: 40_000_000n, wARS: 16_000n * 10n ** 18n, wBRL: 0n },
      CORRIDORS,
      new Map([
        ["wars-usdt", 1600],
        ["wbrl-usdt", 5],
      ]),
    );
    // USDT is split by live buy caps (10 + 20 + 10 + 10 + 10 + 20 = 80): wARS counts 40 × 10/80 = 5
    // USDT, so US$ 10 of wARS vs 5 USDT → 10/15. wBRL: nothing held → 0.
    expect(shares.get("wars-usdt")).toBeCloseTo(10 / 15, 6);
    expect(shares.get("wbrl-usdt")).toBe(0);
  });
});

describe("feed step (circuit breaker)", () => {
  const ok = (f: number) => fairValue(ars, [obs("textile_price", f), obs("dolar_ccl", f), obs("uniswap_mid", f)], NOW);

  it("publishes a fresh price, then holds the old timestamp when sources fail", () => {
    const a = step(ars, {}, ok(1600), undefined, NOW);
    expect(a.decision.action).toBe("publish");
    expect(a.served).toEqual({ price: 1 / 1600, timestamp: NOW / 1000 });
    const later = NOW + 15_000;
    const b = step(ars, a.state, fairValue(ars, [], later), undefined, later);
    expect(b.decision.action).toBe("hold");
    expect(b.served?.timestamp).toBe(NOW / 1000); // ages past staleness_secs → Stitch stops quoting
  });

  it("serves nothing before the first healthy tick", () => {
    expect(step(ars, {}, fairValue(ars, [], NOW), undefined, NOW).served).toBeUndefined();
  });

  it("holds a big jump until it persists, then follows it", () => {
    let s: FeedState = step(ars, {}, ok(1600), undefined, NOW).state;
    const t1 = NOW + 10_000;
    const j1 = step(ars, s, ok(1640), undefined, t1); // +250 bps
    expect(j1.decision.action).toBe("hold");
    expect(j1.served?.price).toBe(1 / 1600);
    s = j1.state;
    const j2 = step(ars, s, ok(1641), undefined, t1 + 10_000); // still confirming
    expect(j2.decision.action).toBe("hold");
    const j3 = step(ars, j2.state, ok(1640), undefined, t1 + ars.jumpConfirmMs);
    expect(j3.decision.action).toBe("publish");
    expect(j3.served?.price).toBeCloseTo(1 / 1640, 12);
  });

  it("drops a one-tick glitch without ever quoting it", () => {
    const s = step(ars, {}, ok(1600), undefined, NOW).state;
    const g = step(ars, s, ok(1800), undefined, NOW + 10_000);
    expect(g.decision.action).toBe("hold");
    const back = step(ars, g.state, ok(1601), undefined, NOW + 20_000);
    expect(back.decision.action).toBe("publish");
    expect(back.served?.price).toBeCloseTo(1 / 1601, 12);
  });

  it("applies the inventory skew to what it publishes", () => {
    const long = step(ars, {}, ok(1600), 0.9, NOW);
    expect(long.decision.skewBps).toBeLessThan(0);
    expect(long.served!.price).toBeLessThan(1 / 1600);
  });
});

describe("stitch.toml", () => {
  const toml = stitchToml(CORRIDORS, { feedBaseUrl: "http://feed:8790/" });

  it("points each pool at its own feed with fixed caps (never max)", () => {
    expect(toml).toContain('feed_url = "http://feed:8790/feed/wars-usdt"');
    expect(toml).toContain('feed_url = "http://feed:8790/feed/wbrl-usdt"');
    expect(toml).not.toMatch(/"max"/);
    expect(toml).toContain(`buy_total_liquidity_debt = "${ars.buyCapUsdt}"`);
    expect(toml).toContain(`sell_total_liquidity_collateral = "${brl.sellCapSoft}"`);
  });

  it("quotes only funded (live) corridors", () => {
    const dry = stitchToml(CORRIDORS.map((c) => (c.pair === "wcop-usdt" ? { ...c, live: false } : c)), { feedBaseUrl: "http://feed:8790" });
    expect(dry).not.toContain("/feed/wcop-usdt");
    for (const c of CORRIDORS) expect(toml.includes(`/feed/${c.pair}"`)).toBe(c.live);
  });

  it("uses the Celo chain block from Stitch's own template and leaves [rfq] to connect", () => {
    expect(toml).toContain("chain_id = 42220");
    expect(toml).toContain('reactor = "0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3"');
    expect(toml).toContain("book_enabled = false");
    expect(toml).toContain(`collateral = "${TOKENS.wARS.address}"`);
    expect(toml).not.toMatch(/^\[rfq\]/m);
    // Root keys must come before the first table, or TOML attaches them to it.
    expect(toml.indexOf("book_enabled")).toBeLessThan(toml.indexOf("[feed]"));
  });
});
