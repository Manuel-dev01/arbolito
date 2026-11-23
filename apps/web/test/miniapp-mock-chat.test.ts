import { describe, expect, it } from "vitest";
import { parseMockChat } from "../src/lib/miniapp/client/mock";

/** The demo is what a judge types into: it must read the currencies Arbolito really changes. */
describe("demo chat", () => {
  it.each([
    ["change 20 dollars to naira", "USDT", "cNGN", "20"],
    ["change 100 dollars to pesos", "USDT", "wARS", "100"],
    ["convert 2k naira to dollars", "cNGN", "USDT", "2000"],
    ["abeg send 5,000 naira give Ada", "cNGN", "USDT", "5000"],
    ["pasá 100 dólares a pesos", "USDT", "wARS", "100"],
    ["troca 200 reais por pesos", "wBRL", "wARS", "200"],
    ["manda 200 reais pra Lucía", "wBRL", "wARS", "200"],
    ["cambiá 5000 pesos a dólares", "wARS", "USDT", "5000"],
    ["cuántos pesos me dan por 10 dólares", "USDT", "wARS", "10"],
    ["change 50 dollars to colombian pesos", "USDT", "wCOP", "50"],
    ["change R$ 200 to dollars", "wBRL", "USDT", "200"],
    ["send 20 dollars to mom", "USDT", "wARS", "20"],
    ["10 USDT in naira", "USDT", "cNGN", "10"],
    ["hello", "USDT", "wARS", "100"],
  ] as const)("%s", (text, from, to, amount) => {
    expect(parseMockChat(text, "100")).toEqual({ from, to, amount });
  });
});
