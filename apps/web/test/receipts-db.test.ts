import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.fn();
const row = vi.fn();
vi.mock("@arbolito/db", () => ({ getDb: () => ({}), getPool: () => undefined, listReceiptRows: () => rows(), getReceiptRow: () => row(), getSupersededRow: async () => undefined }));

import { getReceipt, listFileReceipts, listReceipts } from "../src/lib/data";

const down = () => Promise.reject(Object.assign(new Error("Failed query: select ..."), { cause: Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" }) }));
const PUBLISHED = "bf28b8ab-31a9-4679-8028-bcb471f7d980";
const UNKNOWN = "00000000-0000-4000-8000-000000000001";

describe("receipts when the database fails", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://test");
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rows.mockReset();
    row.mockReset();
  });

  it("retries a failed list once and logs the real cause", async () => {
    rows.mockImplementationOnce(down).mockResolvedValueOnce([]);
    expect((await listReceipts()).length).toBe(listFileReceipts().length);
    expect(rows).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0]![0])).toContain("ECONNRESET Connection terminated unexpectedly");
  });

  it("throws when it still fails, so a fallback is never cached as the answer", async () => {
    rows.mockImplementation(down);
    await expect(listReceipts()).rejects.toThrow();
    expect(rows).toHaveBeenCalledTimes(2);
  });

  it("never reports a receipt as missing when it couldn't look", async () => {
    row.mockImplementation(down);
    await expect(getReceipt(UNKNOWN)).rejects.toThrow();
    expect((await getReceipt(PUBLISHED))?.source).toBe("file");
    row.mockResolvedValue(undefined);
    expect(await getReceipt(UNKNOWN)).toBeUndefined();
  });
});
