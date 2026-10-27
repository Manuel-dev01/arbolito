import { describe, expect, it } from "vitest";
import { CORRIDORS, corridor, validateCorridor } from "../src/corridors";
import { CAP_FLOOR, CARRY_MAX_BPS_PER_DAY, capScale, carryTarget, effectiveCarry, estimateCarry, smooth, type FairSample } from "../src/dynamic";
import { skewBps } from "../src/skew";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 27, 12);

/** Hourly samples for `days` days ending now, the currency weakening by `bpsPerDay`. */
function crawl(days: number, bpsPerDay: number, start = 1600, noise = 0): FairSample[] {
  const out: FairSample[] = [];
  for (let h = days * 24; h >= 0; h--) {
    const at = NOW - h * 3_600_000;
    const d = (at - (NOW - days * DAY)) / DAY;
    out.push({ at, fiatPerUsd: start * Math.exp((bpsPerDay / 10_000) * d) * (1 + noise * Math.sin(h * 1.7)) });
  }
  return out;
}

describe("estimateCarry", () => {
  it("uses the prior until there are three days of history", () => {
    expect(estimateCarry(crawl(1, 5), NOW, 5)).toEqual({ bpsPerDay: 5, source: "prior", days: 0 });
  });

  it("measures a steady crawl, through tick noise", () => {
    const est = estimateCarry(crawl(7, 5, 1600, 0.002), NOW, 0);
    expect(est.source).toBe("measured");
    expect(est.days).toBeGreaterThanOrEqual(7);
    expect(est.bpsPerDay).toBeGreaterThan(4);
    expect(est.bpsPerDay).toBeLessThan(6);
  });

  it("ignores one dislocated day (median per day, Theil–Sen across days)", () => {
    const s = crawl(7, 0, 5.05).map((x) => (Math.abs(x.at - (NOW - 3 * DAY)) < DAY / 2 ? { ...x, fiatPerUsd: 5.45 } : x));
    expect(Math.abs(estimateCarry(s, NOW, 0).bpsPerDay)).toBeLessThan(1);
  });

  it("clamps a runaway measurement", () => {
    expect(estimateCarry(crawl(7, 200), NOW, 0).bpsPerDay).toBe(CARRY_MAX_BPS_PER_DAY);
    expect(estimateCarry(crawl(7, -200), NOW, 0).bpsPerDay).toBe(-CARRY_MAX_BPS_PER_DAY);
  });

  it("only reads the last week", () => {
    const old = crawl(20, 50).filter((x) => NOW - x.at > 8 * DAY);
    expect(estimateCarry(old, NOW, 3)).toEqual({ bpsPerDay: 3, source: "prior", days: 0 });
  });
});

describe("carryTarget", () => {
  const wars = corridor("wars-usdt")!;
  const wbrl = corridor("wbrl-usdt")!;

  it("reproduces the hand-tuned peso target from its prior (0.4 − 0.02 × 5 = 0.3)", () => {
    expect(carryTarget(wars, { bpsPerDay: 5, source: "prior", days: 0 })).toBe(0.3);
    expect(carryTarget(wars, { bpsPerDay: 5, source: "prior", days: 0 })).toBe(wars.skew.targetShare);
  });

  it("weights a measurement by its history: half after a week, full after two", () => {
    expect(effectiveCarry(wbrl, { bpsPerDay: 20, source: "measured", days: 7 })).toBe(10);
    expect(effectiveCarry(wbrl, { bpsPerDay: 20, source: "measured", days: 14 })).toBe(20);
    expect(effectiveCarry(wars, { bpsPerDay: 25, source: "measured", days: 7 })).toBe(15); // ½ × 25 + ½ × 5 prior
    expect(effectiveCarry(wars, { bpsPerDay: 99, source: "prior", days: 0 })).toBe(5); // a prior estimate is the prior
  });

  it("holds less of a currency that is losing value, more of one gaining, within bounds", () => {
    expect(carryTarget(wbrl, { bpsPerDay: 0, source: "measured", days: 7 })).toBe(0.5);
    expect(carryTarget(wbrl, { bpsPerDay: 10, source: "measured", days: 7 })).toBe(0.4);
    expect(carryTarget(wbrl, { bpsPerDay: 25, source: "measured", days: 7 })).toBe(0.25);
    expect(carryTarget(wbrl, { bpsPerDay: 25, source: "measured", days: 14 })).toBe(0.2);
    expect(carryTarget(wbrl, { bpsPerDay: -5, source: "measured", days: 7 })).toBe(0.55);
  });

  it("leaves stable corridors on their fixed target", () => {
    const usdc = corridor("usdc-usdt")!;
    expect(carryTarget(usdc, { bpsPerDay: 20, source: "measured", days: 7 })).toBe(usdc.skew.targetShare);
  });

  it("moves the skew: at the old 0.3 peso target, a measured faster crawl now leans toward selling", () => {
    const faster = { ...wars, skew: { ...wars.skew, targetShare: carryTarget(wars, { bpsPerDay: 7.5, source: "measured", days: 7 }) } };
    expect(skewBps(0.3, wars)).toBe(0);
    expect(skewBps(0.3, faster)).toBeLessThan(0);
  });

  it("every corridor's carry settings are valid", () => {
    expect(CORRIDORS.flatMap(validateCorridor)).toEqual([]);
  });
});

describe("capScale", () => {
  it("keeps the full cap while dispersion is ordinary", () => {
    expect(capScale(undefined, 150)).toBe(1);
    expect(capScale(0, 150)).toBe(1);
    expect(capScale(45, 150)).toBe(1); // 30% of the band
  });

  it("shrinks in quarter steps, rounding down, to a floor", () => {
    expect(capScale(60, 150)).toBe(0.75); // 40% of the band: raw 0.875
    expect(capScale(90, 150)).toBe(0.5); // 60%: raw 0.625
    expect(capScale(120, 150)).toBe(0.25); // 80%: raw 0.375
    expect(capScale(135, 150)).toBe(CAP_FLOOR);
    expect(capScale(500, 150)).toBe(CAP_FLOOR);
  });

  it("is per corridor: the same dispersion means more for a tight stablecoin band", () => {
    expect(capScale(15, 30)).toBeLessThan(capScale(15, 150));
  });

  it("smooths dispersion across ticks", () => {
    let s: number | undefined;
    s = smooth(s, 100);
    expect(s).toBe(100);
    s = smooth(s, 0);
    expect(s).toBeCloseTo(95);
  });
});
