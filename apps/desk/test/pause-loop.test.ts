import { describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import type { LlmClient } from "@arbolito/llm";

// Every source agrees on a steady price, so the breaker never holds on its own.
vi.mock("../src/sources", () => ({
  observeAll: async (_client: unknown, corridors: { pair: string; sources: { id: string }[] }[]) => {
    const now = Date.now();
    const price: Record<string, number> = { "wars-usdt": 1600, "wbrl-usdt": 5.06, "usdc-usdt": 1, "usat-usdt": 1, "wcop-usdt": 3180, "wmxn-usdt": 18.5 };
    return { byPair: new Map(corridors.map((c) => [c.pair, c.sources.map((s) => ({ source: s.id, fiatPerUsd: price[c.pair]!, at: now }))])), errors: [] };
  },
}));

const { FeedService } = await import("../src");

/** An LLM that always pauses wBRL for 15 minutes through the forced decide tool. */
const pausingLlm: LlmClient = {
  async chat() {
    const args = JSON.stringify({ corridors: [{ pair: "wbrl-usdt", action: "pause", minutes: 15, reason: "test" }] });
    const toolCalls = [{ id: "c1", type: "function" as const, function: { name: "decide", arguments: args } }];
    return { message: { role: "assistant", content: null, tool_calls: toolCalls }, toolCalls, finishReason: "tool_calls", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: "fake" };
  },
};

describe("risk officer pause", () => {
  it("a pause's own holds are not counted as breaker holds (no self-renewing pause)", async () => {
    const svc = new FeedService({ client: {} as PublicClient, port: 0, risk: { llm: pausingLlm, model: "m" } });
    const t0 = Date.now();
    await svc.tick(t0);
    await svc.reviewRisk(t0);
    for (let i = 1; i <= 5; i++) await svc.tick(t0 + i * 5_000);
    const brl = svc.riskSignals(t0 + 25_000).find((s) => s.pair === "wbrl-usdt")!;
    expect(brl.paused).toBe("test");
    expect(brl.holds).toBe(0);
    expect(svc.served("wbrl-usdt")).toBeDefined(); // served before the pause, held (stale) since
  });
});
