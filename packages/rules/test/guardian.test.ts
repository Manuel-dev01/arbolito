import { describe, expect, it } from "vitest";
import { decideGuardian, describeRule, guardianTargetPct, guardianTrigger, parseRule, usdMicrosToWfiat, wfiatToUsdMicros, type GuardianSignal } from "../src/index";

const USD = (n: number) => BigInt(Math.round(n * 1e6));
const ARS = (n: number) => BigInt(n) * 10n ** 18n;
const flat: GuardianSignal = { fiatPerUsd: 1650, carryBpsPerDay: 0, carrySource: "measured", holding: false };
const p = { sym: "wARS" as const, baseDollarPct: 50, bandPct: 5 };

describe("guardianTargetPct", () => {
  it("tilts toward dollars when the currency loses value, away when it gains, within 20 points", () => {
    expect(guardianTargetPct(50, 0)).toBe(50);
    expect(guardianTargetPct(50, 5)).toBe(60);
    expect(guardianTargetPct(50, -11.52)).toBe(30);
    expect(guardianTargetPct(50, 40)).toBe(70);
    expect(guardianTargetPct(90, 10)).toBe(100);
    expect(guardianTargetPct(5, -10)).toBe(0);
  });
});

describe("wFIAT ↔ USD", () => {
  it("round-trips at the rate", () => {
    expect(wfiatToUsdMicros(ARS(1650), 1650)).toBe(USD(1));
    expect(usdMicrosToWfiat(USD(1), 1650)).toBe(ARS(1650));
  });
});

describe("decideGuardian", () => {
  it("holds inside the band", () => {
    expect(decideGuardian(p, flat, { wfiat: ARS(1650 * 48), usdt: USD(52) }).action).toBe("hold");
  });

  it("protects: sells pesos for dollars up to the target when below the band", () => {
    const d = decideGuardian(p, flat, { wfiat: ARS(1650 * 80), usdt: USD(20) });
    expect(d.action).toBe("protect");
    if (d.action !== "protect") return;
    expect(d.usdMicros).toBe(USD(30));
    expect(d.amountIn).toBe(ARS(1650 * 30));
    expect(d.reason).toMatch(/flat against the dollar/);
  });

  it("re-enters: buys pesos with dollars when the peso gains and the dollar share is above target", () => {
    const gaining = { ...flat, carryBpsPerDay: -11.52 }; // target 30%
    const d = decideGuardian(p, gaining, { wfiat: ARS(0), usdt: USD(92.76) });
    expect(d.action).toBe("reenter");
    if (d.action !== "reenter") return;
    expect(d.targetPct).toBe(30);
    expect(d.amountIn).toBe(d.usdMicros);
    expect(d.usdMicros).toBe((7_000n * USD(92.76)) / 10_000n);
    expect(d.reason).toMatch(/gaining 3\.5% a month/);
  });

  it("stands down when the desk's sources disagree, or the savings are tiny", () => {
    expect(decideGuardian(p, { ...flat, holding: true }, { wfiat: ARS(1650 * 80), usdt: USD(20) })).toMatchObject({ action: "hold", reason: expect.stringMatching(/disagree/) });
    expect(decideGuardian(p, flat, { wfiat: 0n, usdt: USD(1) })).toMatchObject({ action: "hold", reason: expect.stringMatching(/too small/) });
  });
});

describe("guardian rule", () => {
  it("parses, describes and keys its runs once per direction per day", () => {
    const spec = parseRule("guardian", p);
    expect(describeRule(spec, "es")).toMatch(/50% de tus ahorros en dólares/);
    expect(() => parseRule("guardian", { ...p, sym: "wCOP" })).toThrow();
    expect(guardianTrigger(new Date("2026-11-03T15:00:00Z"), "protect")).toBe("guardian:protect:2026-11-03");
  });
});
