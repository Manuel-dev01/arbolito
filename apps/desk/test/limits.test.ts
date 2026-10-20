import { describe, expect, it } from "vitest";
import { CORRIDORS, DESK_MAKER, RESUME_RATIO, buySidesOff, buySizes, stitchToml, type Balances } from "../src";

const zero: Balances = { USDT: 0n, wARS: 0n, wBRL: 0n, USDC: 0n, USAT: 0n, wCOP: 0n, wMXN: 0n };
const fair = { "wars-usdt": 1 / 1600, "wbrl-usdt": 0.2, "usdc-usdt": 1, "usat-usdt": 1, "wcop-usdt": 1 / 3170, "wmxn-usdt": 1 / 18.5 };
const wbrl = (usd: number) => ({ ...zero, wBRL: BigInt(Math.round(usd / 0.2)) * 10n ** 18n });
const capBrl = CORRIDORS.find((c) => c.pair === "wbrl-usdt")!.maxSoftUsd;

describe("inventory caps", () => {
  it("switches a buy side off at the cap (the US$ 40 of wBRL case)", () => {
    expect(buySidesOff(wbrl(40), CORRIDORS, fair, new Set())).toEqual(new Set(["wbrl-usdt"]));
    expect(buySidesOff(wbrl(capBrl - 1), CORRIDORS, fair, new Set()).has("wbrl-usdt")).toBe(false);
  });

  it("stays off until holdings fall below the resume level (no flapping)", () => {
    const off = new Set(["wbrl-usdt"]);
    expect(buySidesOff(wbrl(capBrl * RESUME_RATIO + 1), CORRIDORS, fair, off).has("wbrl-usdt")).toBe(true);
    expect(buySidesOff(wbrl(capBrl * RESUME_RATIO - 1), CORRIDORS, fair, off).has("wbrl-usdt")).toBe(false);
  });

  it("keeps the previous state when a fair price is missing", () => {
    const { "wbrl-usdt": _, ...noBrl } = fair;
    expect(buySidesOff(wbrl(40), CORRIDORS, noBrl, new Set(["wbrl-usdt"])).has("wbrl-usdt")).toBe(true);
    expect(buySidesOff(wbrl(40), CORRIDORS, noBrl, new Set()).has("wbrl-usdt")).toBe(false);
  });
});

describe("stitch.toml with caps and the maker block", () => {
  const toml = stitchToml(CORRIDORS, { feedBaseUrl: "http://127.0.0.1:8790", buyOff: new Set(["wbrl-usdt"]), rfq: DESK_MAKER });
  const pool = (pair: string) => toml.slice(toml.indexOf(`/feed/${pair}"`), toml.indexOf("ttl_secs", toml.indexOf(`/feed/${pair}"`)));

  it("omits the buy side of a capped corridor and keeps its sell side", () => {
    expect(pool("wbrl-usdt")).not.toContain("buy_total_liquidity_debt");
    expect(pool("wbrl-usdt")).toContain("sell_total_liquidity_collateral");
    expect(pool("wars-usdt")).toContain("buy_total_liquidity_debt");
  });

  it("writes the maker's [rfq] block itself, after the pools", () => {
    expect(toml).toMatch(/\n\[rfq\]\nenabled = true\nurl = "wss:\/\/api\.textilecredit\.com\/v2\/maker\/stream"\nmaker_id = "cmv9mwxsm00a3yx0veu44d0fc"/);
    expect(toml.lastIndexOf("[[pools]]")).toBeLessThan(toml.indexOf("\n[rfq]\n"));
    expect(toml).toContain('feed_url = "http://127.0.0.1:8790/feed/wars-usdt"');
  });
});

describe("buy-side size under the cap", () => {
  const brl = CORRIDORS.find((c) => c.pair === "wbrl-usdt")!; // cap US$ 25, buy size US$ 20
  const sizeAt = (held: number, prev = new Map<string, bigint>()) => buySizes(wbrl(held), CORRIDORS, fair, prev).get("wbrl-usdt");

  it("offers only the room left under the cap, in US$ 5 steps (the US$ 17.6 → 37 overshoot)", () => {
    expect(brl.buyCapUsdt).toBe(20_000_000n);
    expect(sizeAt(0)).toBe(20_000_000n); // plenty of room: the configured size
    expect(sizeAt(17.6)).toBe(5_000_000n); // 7.4 of room → one step, not 20
    expect(sizeAt(22)).toBe(0n); // under a step of room → off
    expect(sizeAt(20.01)).toBe(5_000_000n); // US$ 4.99 of room still counts as a step (US$ 1 tolerance)
  });

  it("grows a step only with a dollar to spare, and shrinks at once", () => {
    const prev = new Map([["wbrl-usdt", 5_000_000n]]);
    expect(sizeAt(15.6, prev)).toBe(5_000_000n); // 9.4 of room: not yet 10 (needs 10 with the tolerance)
    expect(sizeAt(14.6, prev)).toBe(10_000_000n); // 10.4 of room: grows
    expect(sizeAt(21, new Map([["wbrl-usdt", 10_000_000n]]))).toBe(5_000_000n); // shrinks immediately (4 of room + 1 tolerance = one step)
    expect(sizeAt(23, new Map([["wbrl-usdt", 10_000_000n]]))).toBe(0n);
  });

  it("stitch.toml offers the cut size, and switches the side off under one slice", () => {
    const pool = (toml: string) => toml.slice(toml.indexOf(`/feed/wbrl-usdt"`), toml.indexOf("ttl_secs", toml.indexOf(`/feed/wbrl-usdt"`)));
    const five = stitchToml(CORRIDORS, { feedBaseUrl: "http://127.0.0.1:8790", buySize: new Map([["wbrl-usdt", 5_000_000n]]) });
    expect(pool(five)).toContain('buy_total_liquidity_debt = "5000000"');
    const none = stitchToml(CORRIDORS, { feedBaseUrl: "http://127.0.0.1:8790", buySize: new Map([["wbrl-usdt", 0n]]) });
    expect(pool(none)).not.toContain("buy_total_liquidity_debt");
  });
});
