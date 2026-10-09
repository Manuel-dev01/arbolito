import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findReceiptsDir, isReceiptId, readFileRecord, readFileRecords, getReceipt, listReceipts } from "../src/lib/data";
import { computeMetrics } from "../src/lib/metrics";
import { buildReceiptView, compareToReferences, resolveRate, tokenRef, usdNotionalMicros } from "../src/lib/receipt-view";
import { formatMoney, formatRate, parseDecimal } from "../src/lib/format";

const dir = fileURLToPath(new URL("../../../docs/receipts/", import.meta.url));
const BRL_ARS = "bf28b8ab-31a9-4679-8028-bcb471f7d980";
const USD_BRL = "b334459a-884b-4bed-b4a3-d56710ae74ee";

function record(id: string) {
  const r = readFileRecord(id, dir);
  if (!r) throw new Error(`missing ${id}`);
  return r;
}

describe("file fallback (docs/receipts)", () => {
  it("finds docs/receipts by walking up from cwd", () => {
    expect(findReceiptsDir()).toBeTruthy();
    expect(findReceiptsDir(fileURLToPath(new URL("../src/app/", import.meta.url)))).toBeTruthy();
  });

  it("loads every bundle and links superseded files to their replacement", () => {
    const all = readFileRecords(dir);
    expect(all.map((r) => r.id).sort()).toEqual([USD_BRL, `${USD_BRL}.superseded`, BRL_ARS].sort());
    const old = all.find((r) => r.id === `${USD_BRL}.superseded`)!;
    expect(old.supersededBy).toBe(USD_BRL);
    expect(old.bundle.execution.amountOut).toBe("0");
    expect(all.find((r) => r.id === USD_BRL)!.supersedes).toBe(`${USD_BRL}.superseded`);
    expect(all.find((r) => r.id === BRL_ARS)!.supersedes).toBeNull();
  });

  it("rejects ids that are not receipt ids (no path traversal)", () => {
    expect(isReceiptId("../../package")).toBe(false);
    expect(isReceiptId(`${BRL_ARS}.superseded`)).toBe(true);
    expect(readFileRecord("../../package", dir)).toBeUndefined();
    expect(readFileRecord("00000000-0000-0000-0000-000000000000", dir)).toBeUndefined();
  });

  it("serves from files when DATABASE_URL is unset", async () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect((await getReceipt(BRL_ARS))?.source).toBe("file");
      expect(await getReceipt("nope")).toBeUndefined();
      const list = await listReceipts();
      expect(list.length).toBe(3);
      expect(list[0]!.bundle.createdAt >= list[list.length - 1]!.bundle.createdAt).toBe(true);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
    }
  });
});

describe("receipt view", () => {
  it("BRL→ARS: amounts, rate, savings and reference comparisons", () => {
    const v = buildReceiptView(record(BRL_ARS).bundle);
    expect(v.tokenIn.fiat).toBe("BRL");
    expect(v.tokenOut.fiat).toBe("ARS");
    expect(`${formatMoney(v.amountIn, 18, "BRL", "en-US")} → ${formatMoney(v.amountOut, 18, "ARS", "en-US")}`).toBe("R$ 10 → ARS 3,177.41");
    expect(formatRate(v.rate, "en-US")).toBe("317.74");
    expect(v.savings?.bps).toBe(524);

    const official = v.comparisons.find((c) => c.name === "official")!;
    // The direct BRL/ARS official rate reproduces the anchored savings line exactly.
    expect(official.via).toBeUndefined();
    expect(official.referenceOut).toBe(v.savings!.referenceOut);
    expect(official.delta).toBe(v.savings!.delta);
    expect(official.bps).toBe(524);

    // MEP/CCL/crypto are USD/ARS: crossed through the USD/BRL market mid.
    const mep = v.comparisons.find((c) => c.name === "mep")!;
    expect(mep.via).toEqual({ name: "uniswap_mid", pair: "USD/BRL" });
    expect(formatRate(mep.rate, "en-US")).toBe("304.92");
    const crypto = v.comparisons.find((c) => c.name === "crypto")!;
    expect(crypto.delta < 0n).toBe(true);

    // Chosen route appears in alternatives too; it is listed once.
    expect(v.alternatives.map((a) => a.id)).not.toContain(v.chosen.id);
    expect(v.alternatives).toHaveLength(2);
    const textile = v.alternatives.find((a) => a.steps.every((s) => s.venue === "textile_rfq"))!;
    expect(textile.diffVsChosen).toBe(3_192_499871551148332733n - 3_177_411908400035561279n);
    expect(v.chosen.steps.map((s) => `${s.from.symbol}>${s.to.symbol}`)).toEqual(["wBRL>USDT", "USDT>wARS"]);
    expect(v.usdMicros).toBe(1_976342n);
  });

  it("USDT→BRL: no official reference, market mid only", () => {
    const v = buildReceiptView(record(USD_BRL).bundle);
    expect(v.savings).toBeUndefined();
    expect(v.comparisons.map((c) => c.name)).toEqual(["uniswap_mid"]);
    expect(v.usdMicros).toBe(2_500000n);
  });

  it("resolves inverse and missing references", () => {
    const refs = record(BRL_ARS).bundle.references;
    const inv = resolveRate(refs, "official", "ARS", "BRL")!;
    expect(formatRate(inv.rate, "en-US")).toBe("0.003312");
    expect(resolveRate(refs, "textile_mid", "BRL", "ARS")).toBeUndefined();
    const usdOut = compareToReferences(refs, tokenRef("0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D"), tokenRef("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"), 1540n * 10n ** 18n, 1_000000n);
    expect(usdOut.find((c) => c.name === "official")!.rate).toBe((10n ** 36n) / parseDecimal("1540"));
  });

  it("derives the USD notional of a route", () => {
    expect(usdNotionalMicros(record(BRL_ARS).bundle)).toBe(1_976342n);
  });
});

describe("metrics", () => {
  it("counts active receipts only and computes the ARS median", () => {
    const records = readFileRecords(dir);
    const m = computeMetrics(records, new Map([[BRL_ARS, "0x83bbf7a6fd68ca0b0bfd632b931b80fbc078b3dc00ff0125ac0eee3772f91263"]]));
    expect(m.receipts).toHaveLength(2);
    expect(m.superseded).toEqual([{ id: `${USD_BRL}.superseded`, supersededBy: USD_BRL, executionTx: expect.any(String) }]);
    expect(m.wallets).toHaveLength(1);
    expect(m.executionTxs).toHaveLength(2);
    expect(m.anchorTxs).toEqual(["0x83bbf7a6fd68ca0b0bfd632b931b80fbc078b3dc00ff0125ac0eee3772f91263"]);
    expect(m.totalUsdMicros).toBe(2_500000n + 1_976342n);

    const wbrl = m.volumeByToken.find((v) => v.token.symbol === "wBRL")!;
    expect(wbrl.amount).toBe(10n * 10n ** 18n + 12_647118280431389240n);
    expect(wbrl.usdMicros).toBe(2_500000n + 1_976342n);
    expect(wbrl.receiptIds.sort()).toEqual([USD_BRL, BRL_ARS].sort());
    const wars = m.volumeByToken.find((v) => v.token.symbol === "wARS")!;
    expect(wars.amount).toBe(3_177_411908400035561279n);
    expect(m.volumeByToken.some((v) => v.token.symbol === "USDT")).toBe(false);

    expect(m.corridors.map((c) => `${c.from}>${c.to}:${c.count}`).sort()).toEqual(["BRL>ARS:1", "USD>BRL:1"]);
    expect(m.savingsArs.medianBps).toBe(524);
    expect(m.savingsArs.receiptIds).toEqual([BRL_ARS]);
    expect(m.savingsArs.totalDelta).toBe(158_378908400035561279n);
  });

  it("prefers the DB's usdMicros when present and handles no data", () => {
    const r = { ...record(BRL_ARS), usdMicros: "2000000" };
    expect(computeMetrics([r]).totalUsdMicros).toBe(2_000000n);
    const empty = computeMetrics([]);
    expect(empty.receipts).toHaveLength(0);
    expect(empty.savingsArs.medianBps).toBeUndefined();
  });
});
