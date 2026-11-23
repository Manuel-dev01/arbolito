import { describe, expect, it, vi } from "vitest";
import type { PayrollParams } from "@arbolito/rules";
import { MiniAppApiError } from "../src/api";
import { baseRates, heldNote, paydayText, runPayday, type PastPayment, type PayrollDeps } from "../src/payroll";

const ACCOUNT = "0x00000000000000000000000000000000000000a1";
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const NOW = Date.parse("2026-11-27T08:07:00Z");
const params: PayrollParams = {
  payees: [
    { address: A, to: "cNGN", exact: "75000" },
    { address: B, to: "cNGN", usd: "10" },
  ],
  every: { unit: "week", weekday: 5 },
  hourUtc: 8,
  tolerancePct: 3,
  rates: { cNGN: "1450.000000" },
};
const rule = (p: Record<string, unknown> = {}) => ({ id: "r1", account: ACCOUNT, params: params as unknown, lang: "en", nextRunAt: new Date("2026-11-27T08:00:00Z"), confirmedAt: new Date("2026-11-20T10:00:00Z"), ...p });

function rig(o: { rate?: number; fail?: (n: number) => Error | null; past?: PastPayment[]; usdt?: bigint; claimed?: boolean; tellFails?: boolean } = {}) {
  const log: string[] = [];
  const said: string[] = [];
  const asked: Record<string, unknown>[] = [];
  let n = 0;
  const rate = o.rate ?? 1450;
  const deps: PayrollDeps = {
    claim: async (_id, trigger) => (log.push(`claim ${trigger}`), o.claimed ? null : { id: "run1" }),
    setNext: async (_id, at) => void log.push(`next ${at.toISOString()}`),
    finish: async (_id, r) => void log.push(`finish ${r.status}${r.note ? ` ${r.note}` : ""}`),
    stop: async (_id, reason) => void log.push(`stop ${reason}`),
    pastPayments: async () => o.past ?? [],
    quote: vi.fn(async (q: Record<string, unknown>) => {
      asked.push(q);
      const e = o.fail?.(++n);
      if (e) throw e;
      const usd = q.amountOut ? Number(q.amountOut) / rate : Number(q.amount);
      return { amountIn: String(Math.round(usd * 1e6)), expectedOut: String(Math.round((q.amountOut ? Number(q.amountOut) : usd * rate) * 1e6)) };
    }) as never,
    usdtBalance: async () => o.usdt ?? 1_000_000_000n,
    tell: async (_a, text) => {
      if (o.tellFails) throw new Error("telegram down");
      log.push("tell");
      said.push(text);
      return true;
    },
    now: () => NOW,
    sleep: async () => {},
  };
  return { deps, log, said, asked };
}

describe("payroll runner", () => {
  it("claims and reschedules before anything, then prices every payment and tells the payer", async () => {
    const r = rig();
    expect(await runPayday(r.deps, rule())).toBe("ready");
    expect(r.log).toEqual(["claim payroll:2026-11-27", "next 2026-12-04T08:00:00.000Z", "finish ready", "tell"]);
    // Bound to the payee, so a quote can't come back as a plain change.
    expect(r.asked).toEqual([
      { from: "USDT", to: "cNGN", amountOut: "75000", account: ACCOUNT, recipient: A },
      { from: "USDT", to: "cNGN", amount: "10", account: ACCOUNT, recipient: B },
    ]);
    expect(r.said[0]).toBe("Today is payday for 2 people.\n₦ 89,500.00 for about US$ 61.72 at the current price.\nIt's ready on Arbolito's home screen. Nothing goes out until you confirm each payment in MiniPay.");
  });

  it("never runs the same payday twice, and says nothing the second time", async () => {
    const r = rig({ claimed: true });
    expect(await runPayday(r.deps, rule())).toBe("already");
    expect(r.log).toEqual(["claim payroll:2026-11-27", "next 2026-12-04T08:00:00.000Z"]);
  });

  it("holds and explains when the price is past the tolerance", async () => {
    const r = rig({ rate: 1390 });
    expect(await runPayday(r.deps, rule())).toBe("held");
    expect(r.log).toContain("finish held NGN -4.14%");
    expect(r.said[0]).toContain("• NGN: the price is 4.14% worse than the last payday's (your limit is 3%).");
    expect(r.said[0]).toContain("Nothing moved.");
  });

  it("compares with the last payday made, not for ever with the day it was signed", async () => {
    const paid = (rate: bigint, recipient = A): PastPayment => ({ recipient, fill: { to: "cNGN", amountIn: 1_000_000n, amountOut: rate * 1_000_000n } });
    expect(await runPayday(rig({ rate: 1390, past: [paid(1400n), paid(1450n)] }).deps, rule())).toBe("ready");
    expect(baseRates(params, [paid(1400n)])).toEqual({ cNGN: "1400.000000" });
    // A payment to someone outside the list doesn't move the baseline.
    expect(baseRates(params, [paid(900n, "0x3333333333333333333333333333333333333333")])).toEqual({ cNGN: "1450.000000" });
  });

  it("asks a slow market again, and holds when one has no price", async () => {
    const slow = rig({ fail: (n) => (n === 1 ? new MiniAppApiError("upstream", 502, "slow") : null) });
    expect(await runPayday(slow.deps, rule())).toBe("ready");
    expect(slow.asked).toHaveLength(3);
    const none = rig({ fail: (n) => (n === 2 ? new MiniAppApiError("no_route", 422, "none") : null) });
    expect(await runPayday(none.deps, rule())).toBe("held");
    expect(none.asked).toHaveLength(2); // an answer, not asked again
    expect(none.log).toContain("finish held NGN ?");
    expect(none.said[0]).toContain("• NGN: no price right now.");
    expect(none.said[0]).not.toContain("for about"); // no total that leaves someone out
  });

  it("says when the dollars won't be enough", async () => {
    const r = rig({ usdt: 50_000_000n });
    await runPayday(r.deps, rule());
    expect(r.said[0]).toContain("You have US$ 50.00 in USDT: about US$ 11.72 short.");
  });

  it("records the payday even when Telegram fails, skips one found a day late, and stops a list it can't read", async () => {
    const down = rig({ tellFails: true });
    await expect(runPayday(down.deps, rule())).rejects.toThrow("telegram");
    expect(down.log).toContain("finish ready");
    const late = rig();
    expect(await runPayday(late.deps, rule({ nextRunAt: new Date("2026-11-20T08:00:00Z") }))).toBe("skipped");
    expect(late.asked).toEqual([]);
    expect(late.said).toEqual([]);
    const bad = rig();
    expect(await runPayday(bad.deps, rule({ params: { payees: [] } }))).toBe("stopped");
    expect(bad.asked).toEqual([]);
  });

  it("writes in the payer's language", () => {
    const held = { status: "held" as const, fills: [], moves: [{ sym: "wARS" as const, worsePct: 4.1 }], unpriced: ["cNGN" as const] };
    expect(heldNote(held)).toBe("ARS -4.10%, NGN ?");
    expect(paydayText("es", params, held, null)).toContain("• ARS: el precio es 4,10% peor que el del último pago (tu límite es 3%).");
    expect(paydayText("pt", params, held, null)).toContain("• NGN: não há preço agora.");
  });
});
