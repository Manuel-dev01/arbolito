import { describe, expect, it } from "vitest";
import { TOOL_NAMES, parseToolArgs, toolDefinitions } from "../src";

describe("tool definitions", () => {
  it("defines every agent tool in OpenAI function format", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.function.name).sort()).toEqual(
      [
        "add_contact",
        "connect_minipay",
        "deposit_info",
        "get_balances",
        "get_limits",
        "get_quote",
        "get_receipt",
        "help",
        "list_contacts",
        "list_rules",
        "prepare_convert",
        "prepare_payday_split",
        "prepare_scheduled_send",
        "prepare_send",
        "withdraw_guide",
      ].sort(),
    );
    for (const d of defs) {
      expect(d.type).toBe("function");
      expect(d.function.description.length).toBeGreaterThan(10);
      expect(d.function.parameters).toMatchObject({ type: "object", additionalProperties: false });
      expect(d.function.parameters).not.toHaveProperty("$schema");
    }
  });

  it("has no tool that moves funds directly (autonomy policy)", () => {
    for (const name of TOOL_NAMES) expect(name).not.toMatch(/^(execute|transfer|swap|send|convert|withdraw$|approve)/);
    const prep = toolDefinitions(["prepare_convert", "prepare_send"]);
    for (const d of prep) expect(d.function.description).toMatch(/does NOT/);
  });

  it("exposes token enums and string amounts", () => {
    const [quote] = toolDefinitions(["get_quote"]);
    const props = quote!.function.parameters.properties as Record<string, any>;
    expect(props.from.enum).toEqual(["wARS", "wBRL", "USDT", "USAT", "USDC"]);
    expect(props.amount.type).toBe("string");
    expect(quote!.function.parameters.required).toEqual(["from", "to", "amount"]);
  });

  it("can be restricted to a subset", () => {
    expect(toolDefinitions(["help"]).map((d) => d.function.name)).toEqual(["help"]);
  });
});

describe("parseToolArgs", () => {
  it("accepts valid quote args", () => {
    const r = parseToolArgs("get_quote", '{"from":"USAT","to":"wARS","amount":"200"}');
    expect(r).toEqual({ ok: true, name: "get_quote", args: { from: "USAT", to: "wARS", amount: "200" } });
  });

  it("treats empty arguments as {}", () => {
    expect(parseToolArgs("get_balances", "")).toEqual({ ok: true, name: "get_balances", args: {} });
  });

  it("accepts a send to a contact name with a destination currency", () => {
    const r = parseToolArgs("prepare_send", JSON.stringify({ recipient: " Lucía ", amount: "200", token: "wBRL", destinationToken: "wARS" }));
    expect(r.ok && r.name === "prepare_send" && r.args).toEqual({ recipient: "Lucía", amount: "200", token: "wBRL", destinationToken: "wARS" });
  });

  it.each([
    ["unknown token", "get_quote", { from: "BTC", to: "wARS", amount: "1" }],
    ["same from/to", "prepare_convert", { from: "wARS", to: "wARS", amount: "1" }],
    ["comma decimal", "get_quote", { from: "USDT", to: "wARS", amount: "1,5" }],
    ["thousands separator", "get_quote", { from: "USDT", to: "wARS", amount: "1.000.000" }],
    ["exponent", "get_quote", { from: "USDT", to: "wARS", amount: "1e3" }],
    ["negative", "get_quote", { from: "USDT", to: "wARS", amount: "-5" }],
    ["zero", "get_quote", { from: "USDT", to: "wARS", amount: "0.00" }],
    ["number instead of string", "get_quote", { from: "USDT", to: "wARS", amount: 200 }],
    ["too many decimals for USDT", "prepare_convert", { from: "USDT", to: "wARS", amount: "1.1234567" }],
    ["missing field", "get_quote", { from: "USDT", amount: "1" }],
    ["extra field", "prepare_convert", { from: "USDT", to: "wARS", amount: "1", recipient: "0x0000000000000000000000000000000000000001" }],
    ["bad address in send", "prepare_send", { recipient: "0x1234", amount: "1", token: "USDT" }],
    ["bad contact address", "add_contact", { name: "Lucía", address: "lucia.eth" }],
    ["contact name with markup", "add_contact", { name: "<b>x</b>", address: "0x0000000000000000000000000000000000000001" }],
    ["receipt id injection", "get_receipt", { id: "../../etc" }],
  ])("rejects %s", (_label, name, args) => {
    const r = parseToolArgs(name, JSON.stringify(args));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });

  it("accepts 18 decimals for wFIAT", () => {
    expect(parseToolArgs("get_quote", '{"from":"wARS","to":"USDT","amount":"0.123456789012345678"}').ok).toBe(true);
  });

  it("rejects invalid JSON and unknown tools", () => {
    expect(parseToolArgs("get_quote", "{from:")).toMatchObject({ ok: false, error: "arguments are not valid JSON" });
    expect(parseToolArgs("transfer_funds", "{}")).toMatchObject({ ok: false, error: 'unknown tool "transfer_funds"' });
    expect(parseToolArgs("constructor", "{}").ok).toBe(false);
  });
});
