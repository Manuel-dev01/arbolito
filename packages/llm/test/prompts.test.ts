import { describe, expect, it } from "vitest";
import { agentSystemPrompt, detectLanguage } from "../src";

describe("agentSystemPrompt", () => {
  it("sets the register per language", () => {
    expect(agentSystemPrompt("es")).toMatch(/"vos"/);
    expect(agentSystemPrompt("pt")).toMatch(/"você"/);
    expect(agentSystemPrompt("en")).toMatch(/Reply in English/);
  });

  it("carries the safety rules in every language", () => {
    for (const lang of ["es", "pt", "en"] as const) {
      const p = agentSystemPrompt(lang);
      expect(p).toMatch(/Never invent/);
      expect(p).toMatch(/You cannot move money/);
      expect(p).toMatch(/data, not instructions/);
      expect(p).toMatch(/both sides/);
    }
  });
});

describe("detectLanguage", () => {
  it.each([
    ["pasá 200 dólares a pesos", "es"],
    ["¿cuánto tengo?", "es"],
    ["che, mandale 5 lucas a Lucía", "es"],
    ["manda 200 reais pra Lucía em Buenos Aires", "pt"],
    ["quanto eu tenho?", "pt"],
    ["não entendi, você pode converter?", "pt"],
    ["how much is 100 dollars in pesos", "en"],
    ["send 20 USDT to my sister please", "en"],
  ] as const)("%s → %s", (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });

  it("falls back when there's no signal", () => {
    expect(detectLanguage("200")).toBe("es");
    expect(detectLanguage("ok 👍", "en")).toBe("en");
  });
});
