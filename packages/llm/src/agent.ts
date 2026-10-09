import { createLlmClient, type AssistantMessage, type ChatMessage, type LlmClient, type ToolMessage, type Usage } from "./client";
import { FALLBACK_REPLY, agentSystemPrompt, detectLanguage, type Language } from "./prompts";
import { parseToolArgs, toolDefinitions, type ToolArgs, type ToolName } from "./tools";

/**
 * One agent turn: system prompt + history + user text, then a bounded tool-use loop.
 * Handlers are injected so this package never imports router/chain/db. No handler moves money:
 * prepare_* handlers return a card; the bot executes only after the user taps Confirm.
 */

/** Something the bot renders next to the reply, e.g. a pending confirmation for prepare_convert. */
export interface AgentCard {
  /** e.g. "convert", "send", "contact", "receipt". */
  kind: string;
  /** e.g. the pending action id the Confirm button refers to. */
  id: string;
  data?: unknown;
}

export interface ToolOutput {
  /** Sent back to the model as JSON (bigints become strings). Say plainly what happened, e.g. { status: "pending_confirmation" }. */
  data: unknown;
  card?: AgentCard;
}

export interface ToolContext {
  toolCallId: string;
  language: Language;
}

export type ToolHandler<N extends ToolName> = (args: ToolArgs[N], ctx: ToolContext) => Promise<ToolOutput>;

/** Only tools with a handler are offered to the model. */
export type ToolHandlers = { [N in ToolName]?: ToolHandler<N> };

/** Throw from a handler when the message is safe to show the model (and so the user). */
export class ToolUserError extends Error {
  constructor(
    message: string,
    readonly code = "tool_error",
  ) {
    super(message);
    this.name = "ToolUserError";
  }
}

export interface ToolCallTrace {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
}

export interface AgentTurnInput {
  /** Prior user/assistant/tool messages. System messages here are dropped (prompt-injection hygiene). */
  history: ChatMessage[];
  userText: string;
  /** Detected from userText when omitted. */
  language?: Language;
  tools: ToolHandlers;
  model: string;
  /** Defaults to createLlmClient() (reads env). */
  client?: LlmClient;
  /** Tool-use rounds before a forced text-only answer. Default 5. */
  maxToolRounds?: number;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface AgentTurnResult {
  text: string;
  cards: AgentCard[];
  language: Language;
  /** Messages produced this turn (user, assistant, tool), to append to the stored history. */
  messages: ChatMessage[];
  toolCalls: ToolCallTrace[];
  usage: Usage;
  stopReason: "final" | "max_rounds";
}

/** JSON with bigints as decimal strings (amounts are bigint end to end). */
function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) ?? "null";
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const language = input.language ?? detectLanguage(input.userText);
  const client = input.client ?? createLlmClient();
  const maxToolRounds = input.maxToolRounds ?? 5;
  const handlers = input.tools;
  const tools = toolDefinitions((Object.keys(handlers) as ToolName[]).filter((n) => handlers[n]));

  const turn: ChatMessage[] = [{ role: "user", content: input.userText }];
  const base: ChatMessage[] = [
    { role: "system", content: agentSystemPrompt(language) },
    ...input.history.filter((m) => m.role !== "system"),
  ];
  const cards: AgentCard[] = [];
  const trace: ToolCallTrace[] = [];
  const usage: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (let round = 0; ; round++) {
    const forceText = round >= maxToolRounds;
    const res = await client.chat({
      model: input.model,
      messages: [...base, ...turn],
      ...(tools.length ? { tools, toolChoice: forceText ? "none" : "auto" } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    usage.promptTokens += res.usage.promptTokens;
    usage.completionTokens += res.usage.completionTokens;
    usage.totalTokens += res.usage.totalTokens;

    if (forceText || res.toolCalls.length === 0) {
      // Drop any stray tool calls on the forced round so stored history stays well-formed.
      const content = res.message.content ?? "";
      turn.push({ role: "assistant", content } satisfies AssistantMessage);
      const text = content.trim() || (cards.length ? "" : FALLBACK_REPLY[language]);
      return { text, cards, language, messages: turn, toolCalls: trace, usage, stopReason: forceText ? "max_rounds" : "final" };
    }

    turn.push(res.message);
    for (const call of res.toolCalls) {
      const out = await runTool(call.id, call.function.name, call.function.arguments, handlers, language);
      trace.push(out.trace);
      if (out.card) cards.push(out.card);
      turn.push({ role: "tool", tool_call_id: call.id, content: out.content } satisfies ToolMessage);
    }
  }
}

async function runTool(
  id: string,
  name: string,
  rawArgs: string,
  handlers: ToolHandlers,
  language: Language,
): Promise<{ content: string; card?: AgentCard; trace: ToolCallTrace }> {
  const fail = (error: string, detail: string) => ({
    content: toJson({ error, detail }),
    trace: { id, name, ok: false, error: `${error}: ${detail}` },
  });

  const parsed = parseToolArgs(name, rawArgs);
  if (!parsed.ok) return fail(parsed.error.startsWith("unknown tool") ? "unknown_tool" : "invalid_arguments", parsed.error);
  const handler = handlers[parsed.name] as ToolHandler<typeof parsed.name> | undefined;
  if (!handler) return fail("unknown_tool", `tool "${name}" is not available`);

  try {
    const out = await (handler as (a: unknown, c: ToolContext) => Promise<ToolOutput>)(parsed.args, { toolCallId: id, language });
    return { content: toJson(out.data), ...(out.card ? { card: out.card } : {}), trace: { id, name, ok: true } };
  } catch (e) {
    // Only ToolUserError messages reach the model; anything else may carry internals.
    if (e instanceof ToolUserError) return fail(e.code, e.message);
    return {
      content: toJson({ error: "tool_failed", detail: "internal error; tell the user it failed and offer to retry" }),
      trace: { id, name, ok: false, error: `tool_failed: ${e instanceof Error ? e.message : String(e)}` },
    };
  }
}
