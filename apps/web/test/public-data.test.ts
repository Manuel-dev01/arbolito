import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MINIPAY_URL, TELEGRAM_URL } from "../src/components/public/links";
import { badgeState, calcRows, parseTyped, pickShowcase, PENDING_WINDOW_MS } from "../src/components/public/public-data";
import { readFileRecord, readFileRecords } from "../src/lib/data";
import { applyRate, formatFixed, formatRate, parseDecimal } from "../src/lib/format";
import { resolveRate } from "../src/lib/receipt-view";

const dir = fileURLToPath(new URL("../../../docs/receipts/", import.meta.url));
const BRL_ARS = "bf28b8ab-31a9-4679-8028-bcb471f7d980";
const USD_BRL = "b334459a-884b-4bed-b4a3-d56710ae74ee";
const ONE = 10n ** 18n;

function record(id: string) {
  const r = readFileRecord(id, dir);
  if (!r) throw new Error(`missing ${id}`);
  return r;
}

describe("calculator rows (Hacé la cuenta)", () => {
  // The BRL→ARS receipt carries the dolarapi and Uniswap references as they were at execution.
  const refs = record(BRL_ARS).bundle.references;
  const rows = calcRows(refs);

  it("puts Arbolito (market mid) first and compares US$ against every Argentine dollar", () => {
    expect(rows.USD.map((r) => r.key)).toEqual(["arbolito", "official", "mep", "blue", "ccl", "crypto"].filter((k) => rows.USD.some((r) => r.key === k)));
    expect(rows.USD[0]!.key).toBe("arbolito");
    expect(rows.USD.some((r) => r.key === "official")).toBe(true);
    expect(rows.USD[0]!.source).toMatch(/^uniswap-v3:0x/);
    for (const r of rows.USD) expect(BigInt(r.rate) > 0n).toBe(true);
  });

  it("crosses R$ → ARS through the USD market mids and keeps the direct official BRL/ARS", () => {
    expect(rows.BRL.map((r) => r.key)).toEqual(["arbolito", "official"]);
    const cross = resolveRate(refs, "uniswap_mid", "BRL", "ARS")!;
    expect(rows.BRL[0]!.rate).toBe(cross.rate.toString());
    const official = rows.BRL.find((r) => r.key === "official")!;
    expect(formatRate(BigInt(official.rate), "en-US")).toBe(formatRate(parseDecimal(refs.find((r) => r.name === "official" && r.pair === "BRL/ARS")!.rate), "en-US"));
  });

  it("drops a currency with no official rate to compare against", () => {
    const noOfficial = refs.filter((r) => r.name !== "official");
    expect(calcRows(noOfficial)).toEqual({ USD: [], BRL: [] });
    expect(calcRows([])).toEqual({ USD: [], BRL: [] });
  });

  it("does the math in bigint: R$ 10 at the official rate reproduces the receipt's reference amount", () => {
    const b = record(BRL_ARS).bundle;
    const official = BigInt(rows.BRL.find((r) => r.key === "official")!.rate);
    expect(applyRate(parseTyped("10", "es-AR"), 18, official, 18)).toBe(BigInt(b.savings!.referenceOut));
  });
});

describe("typed amounts", () => {
  it("reads the locale's separators", () => {
    expect(parseTyped("1.500", "es-AR")).toBe(1_500n * ONE);
    expect(parseTyped("1.500,5", "pt-BR")).toBe(1_500n * ONE + ONE / 2n);
    expect(parseTyped("1,500.5", "en-US")).toBe(1_500n * ONE + ONE / 2n);
    expect(parseTyped("500", "en-US")).toBe(500n * ONE);
    expect(parseTyped("0,25", "es-AR", 6)).toBe(250_000n);
  });
  it("treats half-typed or junk input as zero instead of throwing", () => {
    expect(parseTyped("", "es-AR")).toBe(0n);
    expect(parseTyped(",", "es-AR")).toBe(0n);
    expect(parseTyped("12,", "es-AR")).toBe(12n * ONE);
    expect(parseTyped("1,2,3", "es-AR")).toBe(0n);
    expect(parseTyped("abc", "en-US")).toBe(0n);
  });
  it("round-trips the preset labels", () => {
    for (const locale of ["es-AR", "pt-BR", "en-US"] as const) {
      const label = formatFixed(1_500n * ONE, 18, locale, { dp: 0 });
      expect(parseTyped(label, locale)).toBe(1_500n * ONE);
    }
  });
});

describe("landing showcase receipt", () => {
  it("shows the newest active receipt with a positive saving (the real BRL→ARS trade)", () => {
    const all = readFileRecords(dir);
    expect(pickShowcase(all)?.id).toBe(BRL_ARS);
  });
  it("never shows a superseded receipt, and falls back to the newest active one", () => {
    const all = readFileRecords(dir).filter((r) => r.id !== BRL_ARS);
    expect(pickShowcase(all)?.id).toBe(USD_BRL);
    expect(pickShowcase(all.filter((r) => r.supersededBy))).toBeUndefined();
    expect(pickShowcase([])).toBeUndefined();
  });
});

describe("receipt verification badge", () => {
  const created = "2026-10-09T10:54:15.486Z";
  const t0 = Date.parse(created);
  const ok = { result: { ok: true, anchor: { txHash: "0x1" } } };
  const notAnchored = { result: { ok: false, anchor: null } };
  const wrong = { result: { ok: false, anchor: { txHash: "0x1" } } };
  const down = { error: "timed out" };

  it("maps the server check to Verificado / Registrando / No coincide", () => {
    expect(badgeState(false, created, ok, t0 + 86_400_000)).toBe("verified");
    expect(badgeState(false, created, notAnchored, t0 + 60_000)).toBe("pending");
    expect(badgeState(false, created, notAnchored, t0 + PENDING_WINDOW_MS + 1)).toBe("mismatch");
    expect(badgeState(false, created, wrong, t0 + 60_000)).toBe("mismatch");
  });
  it("keeps superseded receipts flagged, and says when the chain is unreachable", () => {
    expect(badgeState(true, created, ok, t0)).toBe("superseded");
    expect(badgeState(false, created, down, t0 + 60_000)).toBe("pending");
    expect(badgeState(false, created, down, t0 + 86_400_000)).toBe("unavailable");
  });
});

describe("outbound links", () => {
  it("opens MiniPay through its documented deeplink host and the bot on Telegram", () => {
    expect(MINIPAY_URL).toMatch(/^https:\/\/link\.minipay\.xyz\/(discover|miniapp\?id=[0-9a-f-]{36})$/);
    expect(TELEGRAM_URL).toBe("https://t.me/arbolitoo_bot");
  });
});
