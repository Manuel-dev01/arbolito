import { describe, expect, it } from "vitest";
import type { ChatRequest, ChatResult, LlmClient } from "@arbolito/llm";
import { CORRIDORS, MAX_PAUSE_MIN, MIN_PAUSE_MIN, parseDecision, reviewRisk, windowStats } from "../src";

const fakeLlm = (args: string | Error): LlmClient & { calls: ChatRequest[] } => {
  const calls: ChatRequest[] = [];
  return {
    calls,
    async chat(req: ChatRequest): Promise<ChatResult> {
      calls.push(req);
      if (args instanceof Error) throw args;
      const toolCalls = [{ id: "c1", type: "function" as const, function: { name: "decide", arguments: args } }];
      return { message: { role: "assistant", content: null, tool_calls: toolCalls }, toolCalls, finishReason: "tool_calls", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, model: "fake" };
    },
  };
};

describe("risk officer", () => {
  it("only ever pauses within bounds, and drops pairs it doesn't know", () => {
    const d = parseDecision(
      JSON.stringify({
        corridors: [
          { pair: "wars-usdt", action: "pause", minutes: 600, reason: "fills keep landing at negative edge" },
          { pair: "wbrl-usdt", action: "pause", minutes: 1, reason: "vol spike" },
          { pair: "weth-usdt", action: "pause", minutes: 30, reason: "not ours" },
        ],
      }),
      CORRIDORS,
    );
    expect(d).toEqual([
      { pair: "wars-usdt", action: "pause", minutes: MAX_PAUSE_MIN, reason: "fills keep landing at negative edge" },
      { pair: "wbrl-usdt", action: "pause", minutes: MIN_PAUSE_MIN, reason: "vol spike" },
    ]);
  });

  it("ignores malformed output (no action)", () => {
    expect(parseDecision("not json", CORRIDORS)).toEqual([]);
    expect(parseDecision(JSON.stringify({ corridors: [{ pair: "wars-usdt", action: "tighten", reason: "go faster" }] }), CORRIDORS)).toEqual([]);
  });

  it("asks once with the decide tool forced and the signals attached", async () => {
    const llm = fakeLlm(JSON.stringify({ corridors: [{ pair: "wars-usdt", action: "normal", reason: "quiet market" }] }));
    const r = await reviewRisk(llm, "model-x", [{ pair: "wars-usdt", holds: 0, fills: 0 }], CORRIDORS);
    expect(r.decisions).toEqual([{ pair: "wars-usdt", action: "normal", minutes: 0, reason: "quiet market" }]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.toolChoice).toEqual({ type: "function", function: { name: "decide" } });
    expect(llm.calls[0]!.messages.at(-1)!.content).toContain("wars-usdt");
  });

  it("a failed call is no decision, never a throw", async () => {
    const r = await reviewRisk(fakeLlm(new Error("timeout")), "m", [], CORRIDORS);
    expect(r).toEqual({ decisions: [], error: "timeout" });
  });

  it("summarises an hour of fair samples into move and volatility", () => {
    const s = windowStats([
      { at: 0, fiatPerUsd: 1600 },
      { at: 1, fiatPerUsd: 1601.6 },
      { at: 2, fiatPerUsd: 1600 },
    ]);
    expect(s.moveBps).toBe(0);
    expect(s.volBps).toBeGreaterThan(9);
    expect(windowStats([{ at: 0, fiatPerUsd: 1 }])).toEqual({});
  });
});
