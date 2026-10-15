/**
 * The desk's risk officer: an LLM that reviews a compact summary of market and desk state and may
 * PAUSE a corridor for a while. Hard limits live here, in code, not in the prompt:
 * - its only action is a bounded pause (15–120 min) with a reason; it cannot tighten spreads,
 *   resume a circuit-breaker hold, change sizes or move money;
 * - anything it returns that doesn't parse is ignored (no action), and a failed call changes nothing:
 *   the deterministic breaker in feed.ts already covers stale, disagreeing and jumping prices.
 */
import { z } from "zod";
import type { LlmClient, ToolDefinition } from "@arbolito/llm";
import type { Corridor } from "./corridors";

export const MIN_PAUSE_MIN = 15;
export const MAX_PAUSE_MIN = 120;

export interface CorridorSignals {
  pair: string;
  /** Fair (fiat per USD) now and its change over the window, bps. */
  fairNow?: number;
  moveBps?: number;
  /** Std-dev of tick-to-tick fair changes over the window, bps. */
  volBps?: number;
  /** Max source deviation from fair now, bps. */
  dispersionBps?: number;
  /** Breaker holds in the window. */
  holds: number;
  /** Soft-asset share of the corridor's value (0..1). */
  share?: number;
  /** Fills in the window and their average edge vs fair, bps. */
  fills: number;
  avgEdgeBps?: number;
  /** Currently paused by the officer, and why. */
  paused?: string;
}

export interface RiskDecision {
  pair: string;
  action: "normal" | "pause";
  minutes: number;
  reason: string;
}

const decisionSchema = z.object({
  corridors: z.array(
    z.object({
      pair: z.string(),
      action: z.enum(["normal", "pause"]),
      minutes: z.number().int().optional(),
      reason: z.string().min(3).max(300),
    }),
  ),
});

export const RISK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "decide",
    description: "Record the decision for every corridor. Pause only with a concrete reason from the signals.",
    parameters: {
      type: "object",
      properties: {
        corridors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              pair: { type: "string" },
              action: { type: "string", enum: ["normal", "pause"] },
              minutes: { type: "integer", minimum: MIN_PAUSE_MIN, maximum: MAX_PAUSE_MIN },
              reason: { type: "string" },
            },
            required: ["pair", "action", "reason"],
          },
        },
      },
      required: ["corridors"],
    },
  },
};

export const RISK_SYSTEM = `You are the risk officer of Arbolito Desk, a small market maker that answers Textile RFQs on Celo for wARS/USDT and wBRL/USDT from its own capped inventory (about US$ 10 per side).
Pricing is automatic: a multi-source fair value, an inventory skew, and a circuit breaker that already stops quoting when sources are stale, disagree, or jump.
Your only power is to PAUSE a corridor for ${MIN_PAUSE_MIN}–${MAX_PAUSE_MIN} minutes, or leave it NORMAL. You cannot tighten spreads, resize, or trade.
Pause only for a concrete reason visible in the signals, for example:
- fills keep landing at negative edge (we are being picked off by better-informed flow);
- volatility or the price move over the last hour is far above normal for the pair (Argentine peso: a crawl of ~5 bps/day; real: a few tens of bps/day);
- repeated breaker holds suggesting an unstable market.
Otherwise return NORMAL: a quiet market is the normal case. Keep reasons short and factual. Always call the decide tool once, covering every corridor.`;

/** Parse and clamp the model's tool call; unknown pairs and malformed output are dropped. */
export function parseDecision(argsJson: string, corridors: readonly Corridor[]): RiskDecision[] {
  let raw: unknown;
  try {
    raw = JSON.parse(argsJson);
  } catch {
    return [];
  }
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) return [];
  const pairs = new Set<string>(corridors.map((c) => c.pair));
  return parsed.data.corridors
    .filter((d) => pairs.has(d.pair))
    .map((d) => ({
      pair: d.pair,
      action: d.action,
      minutes: d.action === "pause" ? Math.max(MIN_PAUSE_MIN, Math.min(MAX_PAUSE_MIN, d.minutes ?? MIN_PAUSE_MIN)) : 0,
      reason: d.reason,
    }));
}

/** One review: signals in, bounded decisions out. Never throws; a failure is "no decision". */
export async function reviewRisk(llm: LlmClient, model: string, signals: CorridorSignals[], corridors: readonly Corridor[]): Promise<{ decisions: RiskDecision[]; error?: string }> {
  try {
    const res = await llm.chat({
      model,
      messages: [
        { role: "system", content: RISK_SYSTEM },
        { role: "user", content: `Signals for the last hour (JSON):\n${JSON.stringify(signals)}` },
      ],
      tools: [RISK_TOOL],
      toolChoice: { type: "function", function: { name: "decide" } },
      temperature: 0,
      maxTokens: 400,
      timeoutMs: 45_000,
    });
    const call = res.toolCalls.find((c) => c.function.name === "decide");
    if (!call) return { decisions: [], error: "no decide call" };
    return { decisions: parseDecision(call.function.arguments, corridors) };
  } catch (e) {
    return { decisions: [], error: (e as Error).message };
  }
}

/** Summary statistics over a window of {at, fiatPerUsd} samples. Pure. */
export function windowStats(samples: { at: number; fiatPerUsd: number }[]): { moveBps?: number; volBps?: number } {
  if (samples.length < 2) return {};
  const first = samples[0]!.fiatPerUsd;
  const last = samples[samples.length - 1]!.fiatPerUsd;
  const rets = samples.slice(1).map((s, i) => (s.fiatPerUsd / samples[i]!.fiatPerUsd - 1) * 10_000);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length);
  return { moveBps: Math.round((last / first - 1) * 100_000) / 10, volBps: Math.round(vol * 100) / 100 };
}
