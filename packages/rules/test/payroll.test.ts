import { describe, expect, it } from "vitest";
import { PayrollParams, describePayroll, morningHourUtc, nextPayday, parseRule, payrollText, payrollTrigger, pricesPast, ratesOf } from "../src";

const ACCOUNT = "0x7769a27123aac03693065cd61a003c9dbb8ba734";
const A = "0x7e0316b2533f6df2e651295a9b11481bb8346c3c";
const B = "0x2222222222222222222222222222222222222222";
const params = (p: Partial<PayrollParams> = {}): PayrollParams => ({
  payees: [
    { address: A, to: "cNGN", exact: "75000" },
    { address: B, to: "wARS", usd: "25" },
  ],
  every: { unit: "week", weekday: 5 },
  hourUtc: 8,
  tolerancePct: 3,
  rates: { cNGN: "1445.970000", wARS: "1600.000000" },
  ...p,
});

describe("scheduled payroll", () => {
  it("accepts a list, and refuses what could pay wrongly", () => {
    expect(parseRule("payroll", params()).kind).toBe("payroll");
    const bad = (p: Partial<PayrollParams>) => expect(PayrollParams.safeParse(params(p)).success).toBe(false);
    bad({ payees: [] });
    bad({ payees: [{ address: A, to: "cNGN", exact: "1", usd: "1" }] });
    bad({ payees: [{ address: A, to: "cNGN" }] });
    bad({ payees: [{ address: A, to: "wARS", exact: "1000" }] }); // not payable to the exact amount
    bad({ payees: [{ address: A, to: "cNGN", usd: "0.50" }] });
    bad({ payees: [{ address: A, to: "cNGN", usd: "5" }, { address: A.toUpperCase().replace("0X", "0x"), to: "wARS", usd: "5" }] });
    bad({ payees: [{ address: A, to: "wBRL", usd: "5" }] }); // no price to compare with
    bad({ every: { unit: "month", day: 31 } });
    bad({ tolerancePct: 0 });
  });

  it("falls due weekly and monthly, strictly after the moment asked", () => {
    const week = params();
    expect(nextPayday(week, new Date("2026-11-23T15:00:00Z")).toISOString()).toBe("2026-11-27T08:00:00.000Z");
    expect(nextPayday(week, new Date("2026-11-27T07:59:59Z")).toISOString()).toBe("2026-11-27T08:00:00.000Z");
    expect(nextPayday(week, new Date("2026-11-27T08:00:00Z")).toISOString()).toBe("2026-12-04T08:00:00.000Z");
    expect(nextPayday(week, new Date("2026-12-30T00:00:00Z")).toISOString()).toBe("2027-01-01T08:00:00.000Z");
    const month = params({ every: { unit: "month", day: 25 } });
    expect(nextPayday(month, new Date("2026-11-25T08:00:00Z")).toISOString()).toBe("2026-12-25T08:00:00.000Z");
    expect(payrollTrigger(new Date("2026-11-27T08:00:00Z"))).toBe("payroll:2026-11-27");
  });

  it("is due at 9 in the morning for the payer", () => {
    expect([morningHourUtc(-60), morningHourUtc(180), morningHourUtc(0), morningHourUtc(-720)]).toEqual([8, 12, 9, 0]);
  });

  it("averages a currency's price over its payments", () => {
    expect(ratesOf([
      { to: "cNGN", amountIn: 1_000_000n, amountOut: 1_400_000_000n },
      { to: "cNGN", amountIn: 3_000_000n, amountOut: 4_500_000_000n },
      { to: "wARS", amountIn: 2_000_000n, amountOut: 3_200n * 10n ** 18n },
    ])).toEqual({ cNGN: "1475.000000", wARS: "1600.000000" });
    expect(ratesOf([])).toEqual({});
  });

  it("holds only for a price worse than the tolerance, worst first", () => {
    expect(pricesPast({ cNGN: "1000" }, { cNGN: "970" }, 3)).toEqual([]); // exactly at the limit
    expect(pricesPast({ cNGN: "1000" }, { cNGN: "969" }, 3)).toEqual([{ sym: "cNGN", worsePct: 3.1 }]);
    expect(pricesPast({ cNGN: "1000" }, { cNGN: "2000" }, 3)).toEqual([]);
    expect(pricesPast({ cNGN: "1000", wARS: "100" }, { cNGN: "950", wARS: "80" }, 3).map((m) => m.sym)).toEqual(["wARS", "cNGN"]);
    expect(pricesPast({}, { cNGN: "1" }, 3)).toEqual([]);
  });

  it("signs every full address and amount, the schedule and the id; lists show none of them", () => {
    const text = payrollText(params(), "11111111-2222-3333-4444-555555555555", ACCOUNT, "en");
    expect(text).toBe(
      [
        "Arbolito: scheduled payments",
        "Account: 0x7769A27123AaC03693065CD61A003C9DBb8BA734",
        "Every Friday, 08:00 UTC",
        "1. 0x7e0316b2533F6dF2E651295A9B11481BB8346c3c: exactly 75000 cNGN",
        "2. 0x2222222222222222222222222222222222222222: 25 USDT in wARS",
        "Held if the price is more than 3% worse than the last payday's.",
        "Today's price: 1 USDT = 1445.970000 cNGN, 1 USDT = 1600.000000 wARS",
        "It moves no money: Arbolito prepares the payments and you confirm each one in MiniPay. You can cancel it any time.",
        "ID: 11111111-2222-3333-4444-555555555555",
      ].join("\n"),
    );
    expect([describePayroll(params(), "en"), describePayroll(params(), "es"), describePayroll(params({ every: { unit: "month", day: 5 } }), "pt")]).toEqual([
      "Every Friday: prepare the payments for 2 people.",
      "Cada viernes: preparar los pagos de 2 personas.",
      "Todo mês, no dia 5: preparar os pagamentos de 2 pessoas.",
    ]);
  });
});
