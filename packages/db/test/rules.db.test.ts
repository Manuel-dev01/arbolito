/**
 * Rules and runs against the real Postgres (DATABASE_URL). Runs in the `db` vitest project.
 * Uses a throwaway account and deletes its rows afterwards.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activateRule, cancelRule, claimRun, closeDb, dueSendRules, finishRun, getDb, getRule, insertRuleDraft, listRules, rules, runsForAccount } from "../src";

const account = `0xtest${randomUUID().replace(/-/g, "").slice(0, 34)}`;
const db = getDb();

afterAll(async () => {
  await db.delete(rules).where(eq(rules.account, account));
  await closeDb();
});

const draft = (kind = "send") => insertRuleDraft(db, { id: randomUUID(), account, kind, params: { any: 1 }, lang: "es", message: "text" });

describe("rules store", () => {
  it("activates a draft once, and a cancelled rule can't be activated", async () => {
    const r = await draft();
    const now = new Date("2026-10-20T10:00:00Z");
    const next = new Date("2026-11-01T13:00:00Z");
    expect(await activateRule(db, r.id, { signature: "0xsig", nextRunAt: next, cursorBlock: null, now })).toBe(true);
    expect(await activateRule(db, r.id, { signature: "0xsig2", nextRunAt: next, cursorBlock: null, now })).toBe(false);
    expect((await getRule(db, r.id))!.signature).toBe("0xsig");
    expect((await dueSendRules(db, new Date("2026-11-01T13:00:01Z"))).some((x) => x.id === r.id)).toBe(true);
    expect((await dueSendRules(db, new Date("2026-10-31T00:00:00Z"))).some((x) => x.id === r.id)).toBe(false);

    const c = await draft();
    expect(await cancelRule(db, c.id)).toBe(true);
    expect(await activateRule(db, c.id, { signature: "0x", nextRunAt: next, cursorBlock: null, now })).toBe(false);
    expect((await listRules(db, account)).map((x) => x.id)).toEqual([r.id]); // cancelled rules aren't listed
  });

  it("claims each (rule, trigger) at most once, so a run can never repeat", async () => {
    const r = await draft();
    const first = await claimRun(db, r.id, "send:2026-11", 50_000_000n);
    expect(first?.status).toBe("running");
    expect(await claimRun(db, r.id, "send:2026-11", 50_000_000n)).toBeNull();
    expect(await claimRun(db, r.id, "send:2026-12", 50_000_000n)).not.toBeNull();
    await finishRun(db, first!.id, { status: "done", amountOut: 80_000n * 10n ** 18n, txHashes: ["0xa", "0xb"] });
    const runs = await runsForAccount(db, account);
    const done = runs.find((x) => x.id === first!.id)!;
    expect(done).toMatchObject({ status: "done", kind: "send", txHashes: ["0xa", "0xb"], amountOut: (80_000n * 10n ** 18n).toString() });
  });
});
