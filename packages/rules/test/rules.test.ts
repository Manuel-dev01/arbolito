import { describe, expect, it } from "vitest";
import { cancelText, describeRule, nextMonthlyRun, parseRule, ruleText, sendTrigger, splitTrigger, usd } from "../src";

const ACCOUNT = "0x7769a27123aac03693065cd61a003c9dbb8ba734";
const MAMA = "0x7e0316b2533f6df2e651295a9b11481bb8346c3c";
const send = parseRule("send", { contact: MAMA, contactName: "Mamá", amountUsdt: "50000000", receive: "wARS", dayOfMonth: 1 });
const split = parseRule("split", { percent: 30, to: "wARS", minIncomingUsdt: "20000000" });

describe("rules", () => {
  it("validates params: day 1–28, percent 1–90, no float amounts, no unknown kinds", () => {
    expect(() => parseRule("send", { contact: MAMA, contactName: "M", amountUsdt: "5", receive: "wARS", dayOfMonth: 31 })).toThrow();
    expect(() => parseRule("send", { contact: MAMA, contactName: "M", amountUsdt: "5.5", receive: "wARS", dayOfMonth: 1 })).toThrow();
    expect(() => parseRule("split", { percent: 95, to: "wARS", minIncomingUsdt: "1" })).toThrow();
    expect(() => parseRule("split", { percent: 30, to: "USDT", minIncomingUsdt: "1" })).toThrow(); // USDT → USDT isn't a split
    expect(() => parseRule("sweep", {})).toThrow();
  });

  it("schedules the next run at 13:00 UTC on the day, this month or next", () => {
    expect(nextMonthlyRun(1, new Date("2026-10-20T10:00:00Z")).toISOString()).toBe("2026-11-01T13:00:00.000Z");
    expect(nextMonthlyRun(25, new Date("2026-10-20T10:00:00Z")).toISOString()).toBe("2026-10-25T13:00:00.000Z");
    expect(nextMonthlyRun(20, new Date("2026-10-20T13:00:00Z")).toISOString()).toBe("2026-11-20T13:00:00.000Z"); // exactly now: next month
    expect(nextMonthlyRun(15, new Date("2026-12-20T00:00:00Z")).toISOString()).toBe("2027-01-15T13:00:00.000Z");
  });

  it("has one idempotency key per month and per incoming transfer", () => {
    expect(sendTrigger(new Date("2026-11-01T13:00:00Z"))).toBe("send:2026-11");
    expect(splitTrigger("0xABC", 3)).toBe("split:0xabc:3");
  });

  it("describes and formats amounts per language", () => {
    expect(usd("1234560000", "es")).toBe("US$ 1.234,56");
    expect(usd("1234560000", "en")).toBe("US$ 1,234.56");
    expect(describeRule(send, "es")).toBe("Cada mes, el día 1: enviar US$ 50,00 a Mamá, que recibe pesos (wARS).");
    expect(describeRule(split, "pt")).toBe("Quando chegarem pelo menos US$ 20,00, trocar 30% por pesos (wARS).");
  });

  it("signs a text that names the account, the full contact address and the rule id", () => {
    const text = ruleText(send, "11111111-2222-3333-4444-555555555555", ACCOUNT, "en");
    expect(text).toContain("Account: 0x7769A27123AaC03693065CD61A003C9DBb8BA734");
    expect(text).toContain("To: 0x7e0316b2533F6dF2E651295A9B11481BB8346c3c");
    expect(text).toContain("ID: 11111111-2222-3333-4444-555555555555");
    expect(cancelText("abc", ACCOUNT)).toBe("Arbolito: cancel rule\nAccount: 0x7769A27123AaC03693065CD61A003C9DBb8BA734\nID: abc");
  });
});
