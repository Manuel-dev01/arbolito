import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn();
const latest = vi.fn();
vi.mock("@arbolito/db", () => ({ insertCompetitorRates: (...a: unknown[]) => insert(...a), latestCompetitorRates: (...a: unknown[]) => latest(...a) }));

import { latestCbnUsd, refreshCbn } from "../src/official-rates";

const row = (ratedate: string, centralrate: string, currency = "US DOLLAR") => ({ id: 1, currency, ratedate, buyingrate: "1", centralrate, sellingrate: "1" });
const NOW = Date.parse("2026-11-23T12:00:00Z");

describe("CBN official USD/NGN", () => {
  it("takes the newest US dollar central rate, whatever the order", () => {
    const r = latestCbnUsd([row("2026-11-19", "1376.0807"), row("2026-11-20", "1389.2335"), row("2026-11-21", "1800", "EURO"), row("2026-11-18", "1362.7331")], NOW)!;
    expect([r.rate, r.at.toISOString()]).toEqual(["1389.2335", "2026-11-20T00:00:00.000Z"]);
  });

  it("ignores rows that make no sense", () => {
    expect(latestCbnUsd([row("2027-01-01", "1400"), row("20-11-2026", "1400"), row("2026-11-20", "0"), row("2026-11-20", "1,389.23"), row("2026-11-20", "1e9"), null], NOW)).toBeNull();
    expect(latestCbnUsd({ error: "x" }, NOW)).toBeNull();
  });

  describe("storing", () => {
    const answer = (rows: unknown, ok = true) => vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => rows })) as unknown as typeof fetch;
    beforeEach(() => {
      insert.mockReset();
      latest.mockReset().mockResolvedValue([]);
    });

    it("stores a new rate under its own date, unpaid", async () => {
      await refreshCbn({} as never, answer([row("2026-11-20", "1389.2335")]));
      expect(insert.mock.calls[0]![1]).toEqual([expect.objectContaining({ provider: "cbn", corridor: "USD-NGN", rate: "1389.2335", at: new Date("2026-11-20T00:00:00Z") })]);
      expect(insert.mock.calls[0]![1][0].paymentTx).toBeUndefined();
    });

    it("stores each date once, and skips the download once today's is in", async () => {
      latest.mockResolvedValue([{ rate: "1389.2335", at: new Date("2026-11-20T00:00:00Z") }]);
      expect(await refreshCbn({} as never, answer([row("2026-11-20", "1389.2335")]))).toBeNull();
      latest.mockResolvedValue([{ rate: "1389.2335", at: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) }]);
      const f = answer([]);
      expect(await refreshCbn({} as never, f)).toBeNull();
      expect(f).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it("stores nothing on a bad answer or an implausible jump", async () => {
      await expect(refreshCbn({} as never, answer([], false))).rejects.toThrow("503");
      await expect(refreshCbn({} as never, answer([]))).rejects.toThrow("no usable");
      latest.mockResolvedValue([{ rate: "1000", at: new Date("2026-11-19T00:00:00Z") }]);
      await expect(refreshCbn({} as never, answer([row("2026-11-20", "1389.2335")]))).rejects.toThrow("jumped");
      expect(insert).not.toHaveBeenCalled();
    });
  });
});
