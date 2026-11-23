import { beforeEach, describe, expect, it, vi } from "vitest";

const latest = vi.fn();
vi.mock("@arbolito/db", () => ({ latestCompetitorRates: (...a: unknown[]) => latest(...a) }));

import { CBN_CURRENT_MS, cbnReference } from "../src/lib/miniapp/server/competitors";

const stored = { provider: "cbn", corridor: "USD-NGN", rate: "1389.2335", sourceUrl: "https://www.cbn.gov.ng/api/GetAllExchangeRates#USD.centralrate", at: new Date("2026-11-20T00:00:00Z") };
const at = (iso: string) => cbnReference({} as never, Date.parse(iso));

describe("CBN official USD/NGN as a reference", () => {
  // The store applies the window, as the real query does.
  beforeEach(() => latest.mockReset().mockImplementation(async (_db: unknown, provider: string, maxAge: number, now: number) => (provider === "cbn" && stored.at.getTime() >= now - maxAge ? [stored] : [])));

  it("is official, under its own date, that day and the next", async () => {
    expect(await at("2026-11-20T18:00:00Z")).toEqual([{ name: "official", pair: "USD/NGN", rate: "1389.2335", source: stored.sourceUrl, at: "2026-11-20T00:00:00.000Z" }]);
    expect(await at("2026-11-21T23:59:00Z")).toHaveLength(1);
  });

  it("never compares Monday's price with Friday's rate", async () => {
    expect(await at("2026-11-22T00:01:00Z")).toEqual([]);
    expect(await at("2026-11-23T10:00:00Z")).toEqual([]);
    expect(CBN_CURRENT_MS).toBe(48 * 3_600_000);
  });

  it("ignores a rate dated ahead, and works without a database", async () => {
    expect(await at("2026-11-19T10:00:00Z")).toEqual([]);
    expect(await cbnReference(null)).toEqual([]);
  });
});
