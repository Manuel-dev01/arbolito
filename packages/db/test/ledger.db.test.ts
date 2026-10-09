/**
 * DbLedger against the real Postgres (DATABASE_URL). Runs in the `db` vitest project.
 * Uses a throwaway scope and deletes its rows afterwards.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CapExceededError, USD, checkCaps } from "@arbolito/chain";
import { DbLedger, closeDb, getDb, spendLedger } from "../src";

const scope = `0xtest${randomUUID().replace(/-/g, "").slice(0, 34)}`;
const db = getDb();
const ledger = new DbLedger(db, scope);
const caps = { maxActionMicros: USD(5), maxDailyMicros: USD(25) };

afterAll(async () => {
  await db.delete(spendLedger).where(eq(spendLedger.scope, scope.toLowerCase()));
  await closeDb();
});

describe("DbLedger", () => {
  it("sums reservations per scope and day, ignoring released ones", async () => {
    const day = "2026-10-09";
    await ledger.reserve(day, { id: randomUUID(), at: "", purpose: "swap a", usdMicros: USD(4).toString() });
    const b = randomUUID();
    await ledger.reserve(day, { id: b, at: "", purpose: "swap b", usdMicros: USD(3).toString() });
    expect(await ledger.spent(day)).toBe(USD(7));

    await ledger.update(day, b, { status: "released" });
    expect(await ledger.spent(day)).toBe(USD(4));
    expect(await ledger.spent("2026-10-10")).toBe(0n);
  });

  it("keeps caps per wallet: another scope's spend does not count", async () => {
    const other = new DbLedger(db, `${scope}ff`);
    expect(await other.spent("2026-10-09")).toBe(0n);
  });

  it("feeds checkCaps across processes (state lives in Postgres)", async () => {
    const day = "2026-10-11";
    await ledger.reserve(day, { id: randomUUID(), at: "", purpose: "big", usdMicros: USD(24).toString() });
    const fresh = new DbLedger(getDb(), scope); // a second instance sees the same state
    const spent = await fresh.spent(day);
    expect(() => checkCaps(USD(2), spent, caps)).toThrow(CapExceededError);
  });

  it("records the tx hash and status on update", async () => {
    const day = "2026-10-12";
    const id = randomUUID();
    await ledger.reserve(day, { id, at: "", purpose: "swap", usdMicros: USD(1).toString() });
    await ledger.update(day, id, { status: "confirmed", txHash: `0x${"ab".repeat(32)}` });
    const [row] = await db.select().from(spendLedger).where(eq(spendLedger.id, id));
    expect(row?.status).toBe("confirmed");
    expect(row?.txHash).toBe(`0x${"ab".repeat(32)}`);
    expect(row?.scope).toBe(scope.toLowerCase());
  });
});
