import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PAYROLL_EXACT, PAYROLL_SYMS, cancelText, payrollText, type PayrollParams } from "@arbolito/rules";
import { TOKENS } from "@arbolito/config";
import { EXACT_OUT, PayrollCreateRequest, RulesListResponse } from "../src/lib/miniapp/contract";
import { DECIMALS } from "../src/lib/miniapp/client/format";
import type { RulesList } from "../src/lib/miniapp/client/api";
import { duePaydays, leftToPay, maybePaid, paidRates, payrollParams, reviewMoves, scheduleItems, type Due, type Schedule } from "../src/lib/miniapp/client/payday";
import type { PayoutItem, PayoutRun } from "../src/lib/miniapp/client/payout";
import { createStore } from "../src/lib/miniapp/client/store";
import { memoryKV } from "../src/lib/miniapp/client/mock";
import { setDeps } from "../src/lib/miniapp/server/deps";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { cancelRuleReq, createPayroll, listRulesRes } from "../src/lib/miniapp/server/rules";
import { ACCOUNT, OTHER, makeRig, wallet } from "./miniapp-helpers";

const A = "0x2222222222222222222222222222222222222222";
const B = "0x3333333333333333333333333333333333333333";
const RULE = "5c0f7a52-6f0e-4c1c-8d53-9a3f2b7c1e10";
const schedule = (p: Partial<Schedule> = {}): Schedule => ({
  ruleId: RULE,
  items: [
    { contactId: "c1", name: "Ada", address: A, to: "cNGN", exact: "75000" },
    { contactId: "c2", name: "Bola", address: B, to: "cNGN", amount: "10" },
  ],
  every: { unit: "week", weekday: 5 },
  hourUtc: 8,
  tolerancePct: 3,
  rates: { cNGN: "1450.000000" },
  ...p,
});
const AT = "2026-11-27T08:07:00.000Z";
const NOW = Date.parse("2026-11-27T10:00:00Z");
const list = (p: { status?: string; at?: string; ruleStatus?: "active" | "stopped"; error?: string | null } = {}): RulesList => ({
  rules: [{ ruleId: RULE, kind: "payroll", status: p.ruleStatus ?? "active", description: "", message: "", nextRunAt: null, stoppedReason: null }],
  runs: [{ ruleId: RULE, kind: "payroll", status: p.status ?? "ready", at: p.at ?? AT, txHashes: [], error: p.error ?? null }],
});
const due = (s = schedule()): Due => ({ schedule: s, at: AT, held: false, note: null });
const item = (address: string, p: Partial<PayoutItem> = {}): PayoutItem => ({ contactId: address, name: "x", address, from: "USDT", to: "cNGN", amount: "10", reviewedOut: "14500000000", state: "todo", ...p });

async function failure(p: Promise<unknown>): Promise<ApiFailure> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  throw new Error("expected an ApiFailure");
}

afterEach(() => setDeps(undefined));

describe("payday on the phone", () => {
  it("shares its currencies and decimals with the app", () => {
    expect([...PAYROLL_EXACT].sort()).toEqual([...EXACT_OUT].sort());
    for (const s of PAYROLL_SYMS) expect(DECIMALS[s]).toBe(TOKENS[s].decimals);
  });

  it("shows the newest payday of a schedule that is on, for three days, until it is done", () => {
    expect(duePaydays([schedule()], list(), NOW)).toMatchObject([{ at: AT, held: false }]);
    expect(duePaydays([schedule()], list({ status: "held", error: "NGN -4.10%" }), NOW)).toMatchObject([{ held: true, note: "NGN -4.10%" }]);
    // The bot stopped half way: the payer still sees it.
    expect(duePaydays([schedule()], list({ status: "running" }), NOW)).toHaveLength(1);
    expect(duePaydays([schedule()], list({ status: "skipped" }), NOW)).toEqual([]);
    expect(duePaydays([schedule()], list({ ruleStatus: "stopped" }), NOW)).toEqual([]);
    expect(duePaydays([schedule()], { rules: [], runs: list().runs }, NOW)).toEqual([]);
    expect(duePaydays([schedule()], list(), NOW + 3 * 86_400_000)).toEqual([]);
    expect(duePaydays([schedule({ doneAt: AT })], list(), NOW)).toEqual([]);
  });

  it("never offers a payment that went out, whichever record says so", () => {
    const receipt = { kind: "send" as const, recipient: A.toUpperCase().replace("0X", "0x"), at: "2026-11-27T09:00:00.000Z", to: "cNGN" };
    const names = (d: Due, r: Parameters<typeof leftToPay>[1]) => leftToPay(d, r).map((i) => i.name);
    expect(names(due(), [])).toEqual(["Ada", "Bola"]);
    expect(names(due(), [receipt])).toEqual(["Bola"]);
    expect(names(due(), [{ ...receipt, at: "2026-11-20T09:00:00.000Z" }])).toEqual(["Ada", "Bola"]); // last week's
    expect(names(due(), [{ ...receipt, kind: "change", recipient: null }])).toEqual(["Ada", "Bola"]);
    // This phone started it and never got a receipt: not offered either.
    expect(names(due(schedule({ paid: { at: AT, to: [B] } })), [receipt])).toEqual([]);
    expect(names(due(schedule({ paid: { at: "2026-11-20T08:00:00.000Z", to: [B] } })), [])).toEqual(["Ada", "Bola"]);
  });

  it("counts as maybe paid what was sent or is in doubt, not what was held, stopped or never delivered", () => {
    const run: PayoutRun = { id: "r", at: AT, items: [item("1", { state: "paid" }), item("2", { state: "sending" }), item("3", { state: "unknown" }), item("4", { state: "held" }), item("5", { state: "stopped" }), item("6", { state: "converted" }), item("7")] };
    expect(maybePaid(run)).toEqual(["1", "2", "3"]);
  });

  it("warns on review when the price moved past the tolerance, and takes the paid prices as the next baseline", () => {
    expect(reviewMoves(schedule(), [item(A)])).toEqual([]);
    expect(reviewMoves(schedule(), [item(A, { reviewedOut: "13900000000" })])).toEqual([{ sym: "cNGN", worsePct: 4.14 }]);
    const run: PayoutRun = { id: "r", at: AT, items: [item(A, { state: "paid", paidIn: "10000000", paidOut: "14000000000" }), item(B, { state: "held" })] };
    expect(paidRates(schedule({ rates: { cNGN: "1450.000000", wARS: "1600.000000" } }), run)).toEqual({ cNGN: "1400.000000", wARS: "1600.000000" });
  });

  it("repeats amounts as they were typed, and signs no names", () => {
    const items = scheduleItems([item(A, { exact: "75000", amount: "51.72" }), item(B)]);
    expect(items.map((i) => [i.exact, i.amount])).toEqual([["75000", undefined], [undefined, "10"]]);
    const p = payrollParams(schedule());
    expect(JSON.stringify(p)).not.toMatch(/Ada|Bola/);
    expect(p.payees).toEqual([{ address: A, to: "cNGN", exact: "75000" }, { address: B, to: "cNGN", usd: "10" }]);
  });

  it("keeps schedules per account on the phone", () => {
    const store = createStore(memoryKV());
    store.saveSchedule(ACCOUNT, schedule());
    store.patchSchedule(ACCOUNT, RULE, { doneAt: AT });
    expect(store.schedules(ACCOUNT)).toMatchObject([{ ruleId: RULE, doneAt: AT }]);
    expect(store.schedules(OTHER)).toEqual([]);
    store.removeSchedule(ACCOUNT, RULE);
    expect(store.schedules(ACCOUNT)).toEqual([]);
  });
});

describe("payroll schedules on the server", () => {
  const params: PayrollParams = payrollParams(schedule());
  const request = async (p: PayrollParams = params, id: string = randomUUID(), signed: PayrollParams = p) =>
    PayrollCreateRequest.parse({ id, account: ACCOUNT, lang: "en", params: p, signature: await wallet.signMessage({ message: payrollText(signed, id, ACCOUNT, "en") }) });

  it("stores a schedule only with the account's signature over its exact text", async () => {
    const rig = makeRig();
    const other = { ...params, payees: [{ ...params.payees[0]!, exact: "7500000" }, params.payees[1]!] };
    expect((await failure(createPayroll(rig.deps, await request(other, randomUUID(), params)))).message).toContain("signature");
    expect((await failure(createPayroll(rig.deps, { ...(await request()), account: OTHER }))).message).toContain("signature");
    expect(rig.store.rules).toEqual([]);

    const req = await request();
    const { rule } = await createPayroll(rig.deps, req);
    // T0 is Monday 12 October 2026.
    expect(rule).toMatchObject({ ruleId: req.id, kind: "payroll", status: "active", nextRunAt: "2026-10-16T08:00:00.000Z" });
    // The id is single-use: not again, and not after it is cancelled.
    expect((await failure(createPayroll(rig.deps, req))).status).toBe(409);
    await cancelRuleReq(rig.deps, { ruleId: req.id, account: ACCOUNT, signature: await wallet.signMessage({ message: cancelText(req.id, ACCOUNT) }) });
    expect((await failure(createPayroll(rig.deps, req))).status).toBe(409);
  });

  it("needs no guard, can't pay its own signer, and allows five", async () => {
    const rig = makeRig({ guard: undefined });
    const self = { ...params, payees: [{ address: ACCOUNT, to: "cNGN" as const, usd: "5" }] };
    expect((await failure(createPayroll(rig.deps, await request(self)))).message).toContain("pay the wallet that signs");
    for (let i = 0; i < 5; i++) await createPayroll(rig.deps, await request());
    expect((await failure(createPayroll(rig.deps, await request()))).message).toContain("5 schedules");
  });

  it("never gives the list back to whoever asks for the account", async () => {
    const rig = makeRig();
    await createPayroll(rig.deps, await request());
    const body = JSON.stringify(RulesListResponse.parse(await listRulesRes(rig.deps, ACCOUNT)));
    expect(body).toContain("Every Friday: prepare the payments for 2 people.");
    expect(body.toLowerCase()).not.toContain(A.slice(2));
    expect(body).not.toContain("75000");
  });
});
