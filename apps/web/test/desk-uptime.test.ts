import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (f: unknown) => f }));
const { uptimeFrom, deskStats } = await import("../src/lib/desk");

const NOW = Date.parse("2026-10-20T12:00:00Z");
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000);

describe("/desk numbers", () => {
  it("uptime is the share of snapshots in which a corridor was quoting, per day and week", () => {
    const rows = [
      { at: at(1), quoting: { "wbrl-usdt": true, "wars-usdt": true } },
      { at: at(2), quoting: { "wbrl-usdt": false, "wars-usdt": true } },
      { at: at(30), quoting: { "wbrl-usdt": false, "wars-usdt": true } },
      { at: at(40), quoting: null }, // before quoting was recorded: skipped
      { at: at(24 * 8), quoting: { "wbrl-usdt": true } }, // older than a week: skipped
    ];
    expect(uptimeFrom(rows, NOW)).toEqual({ "wbrl-usdt": { day: 0.5, week: 1 / 3 }, "wars-usdt": { day: 1, week: 1 } });
    expect(uptimeFrom([], NOW)).toEqual({});
  });

  it("stats sum volume and the spread earned at fair", () => {
    const s = deskStats([{ txHash: "0x1", at: "", pair: "wbrl-usdt", side: "buy", softAmount: "0", usdtAmount: "20000000", price: 0.2, fairPrice: 0.2, edgeBps: 5 }]);
    expect(s).toEqual({ fills: 1, volumeMicros: "20000000", spreadMicros: "10000" });
  });
});
