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
/**
 * Longest a corridor may stay paused without a break, however often the officer renews it. Shown
 * its own pause reason, it re-paused wARS every review for 10+ hours over one fill that had left
 * the window long before (2026-10-28); renewals now stop here and the corridor quotes again.
 */
export const MAX_CONTINUOUS_PAUSE_MIN = 120;

export interface CorridorSignals {
  pair: string;
  /** Fair (fiat per USD) now and its change over the window, bps. */
  fairNow?: number;
  moveBps?: number;
  /** Std-dev of tick-to-tick fair changes over the window, bps. */
  volBps?: number;
  /** Max source deviation from fair now, bps. */
  dispersionBps?: number;
  /** The breaker drops any source further than this from fair: dispersion under it is normal for the pair. */
  breakerMaxDevBps?: number;
  /** Breaker holds in the window. */
  holds: number;
  /** Soft-asset share of the corridor's value (0..1). */
  share?: number;
  /** Fills in the window and their average edge vs fair, bps. */
  fills: number;
  avgEdgeBps?: number;
  /** Minutes this corridor has been paused by the officer without a break (absent when not paused). Never the reason: a past reason is not evidence. */
  pausedForMin?: number;
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

export const RISK_SYSTEM = `You are the risk officer of Arbolito Desk, a small market maker that answers Textile RFQs on Celo for wARS, wBRL, wCOP, wMXN, USDC and USA₮ against USDT from its own capped inventory (US$ 10–25 per side). The stable pairs should sit within a few bps of 1.00. wMXN quotes one side only, so a share of 0 there is normal; any corridor can show a low or zero share after the desk rebalances.
Pricing is automatic: a multi-source fair value, an inventory skew, and a circuit breaker that already stops quoting when sources are stale, disagree beyond breakerMaxDevBps, or jump.
Your only power is to PAUSE a corridor for ${MIN_PAUSE_MIN}–${MAX_PAUSE_MIN} minutes, or leave it NORMAL. You cannot tighten spreads, resize, or trade.
A pause has a real cost: the desk is judged on the volume it quotes and fills, and a paused corridor quotes nothing. Pause only for a concrete reason visible in the signals:
- fills keep landing at negative edge (we are being picked off by better-informed flow);
- the price move or volatility over the last hour is far above normal for the pair (Argentine peso: a crawl of ~5 bps/day; real, Colombian and Mexican peso: tens of bps/day, more on news);
- many breaker holds in the hour (the breaker's own, not pauses);
- a stablecoin moving away from 1.00 (fairNow is fiat per USD; for USDC/USA₮ it should be ~1).
Do NOT pause for source dispersion below the corridor's breakerMaxDevBps: different sources (exchange quotes, official and parallel rates, a thin pool) routinely sit tens of bps apart, and the breaker already drops outliers. Do not pause for a share of 0 on its own.
pausedForMin tells you a corridor is already paused. Renew a pause only if this hour's signals show the problem now (for example fills > 0 with negative avgEdgeBps); a pause you set earlier is not evidence, and a corridor with no fills, holds or unusual move this hour should go back to NORMAL.
Otherwise return NORMAL: a quiet market is the normal case. Keep reasons short and factual. Always call the decide tool once, covering every corridor.
If you cannot call tools, reply with only the same JSON object: {"corridors":[{"pair":"…","action":"normal"|"pause","minutes":15-120,"reason":"…"}]}.`;

/** The first top-level JSON object in a text reply (the fallback when the model answers in text). */
export function jsonFromText(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

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
      // DeepSeek V4 thinks by default: it spent a 3,000-token budget reasoning without answering and
      // rejects a forced tool_choice. A bounded pause decision needs neither, so thinking is off.
      toolChoice: { type: "function", function: { name: "decide" } },
      thinking: "disabled",
      temperature: 0,
      maxTokens: 600,
      timeoutMs: 45_000,
    });
    const call = res.toolCalls.find((c) => c.function.name === "decide");
    // Thinking models sometimes answer in text even with the tool offered; the same JSON is accepted.
    const args = call?.function.arguments ?? jsonFromText(res.message.content);
    if (!args) return { decisions: [], error: "no decide call or JSON reply" };
    return { decisions: parseDecision(args, corridors) };
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
