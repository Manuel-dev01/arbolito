import { z } from "zod";
import { loadEnv } from "@arbolito/config";
import { LlmConfigError, LlmResponseError, LlmTimeoutError } from "./errors";
import { requestWithRetry, type RetryPolicy } from "./http";

/**
 * Minimal chat-completions client for OpenAI-compatible APIs (DeepSeek today), on plain fetch.
 * - Non-streaming; one choice per call.
 * - 429/5xx/timeouts retried at most twice with backoff. Safe here: an LLM call moves no money.
 * - Models verified via GET /models on 2026-10-09: deepseek-flash (agent), deepseek-v4-pro (risk officer).
 */

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; /** JSON text, unvalidated: parse with parseToolArgs. */ arguments: string };
}

export interface SystemMessage {
  role: "system";
  content: string;
}
export interface UserMessage {
  role: "user";
  content: string;
}
export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}
export interface ToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}
export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

/** OpenAI function-tool format. `parameters` is a JSON Schema object. */
export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ToolChoice = "auto" | "none" | "required" | { type: "function"; function: { name: string } };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  temperature?: number;
  maxTokens?: number;
  /** Caller cancellation (not retried). */
  signal?: AbortSignal;
  /** Per-attempt timeout; overrides the client default. */
  timeoutMs?: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "insufficient_system_resource" | (string & {});

export interface ChatResult {
  /** Ready to append to the conversation as-is (reasoning text is not included). */
  message: AssistantMessage;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: Usage;
  /** Thinking-mode models return their reasoning separately. Informational only; never shown to users. */
  reasoning?: string;
  model: string;
}

export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResult>;
}

const responseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          role: z.literal("assistant").optional(),
          content: z.string().nullable().optional(),
          reasoning_content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function").optional(),
                function: z.object({ name: z.string(), arguments: z.string().optional() }),
              }),
            )
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({ prompt_tokens: z.number(), completion_tokens: z.number(), total_tokens: z.number() })
    .passthrough()
    .optional(),
});

export interface DeepSeekClientOptions {
  /** Defaults to DEEPSEEK_API_KEY. */
  apiKey?: string;
  /** Defaults to DEEPSEEK_BASE_URL (https://api.deepseek.com). */
  baseUrl?: string;
  fetchFn?: typeof fetch;
  /** Per-attempt timeout. Default 30s. */
  timeoutMs?: number;
  retry?: RetryPolicy;
}

export class DeepSeekClient implements LlmClient {
  private readonly apiKey: string;
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retry: RetryPolicy | undefined;

  constructor(opts: DeepSeekClientOptions = {}) {
    const apiKey = opts.apiKey ?? loadEnv().DEEPSEEK_API_KEY;
    if (!apiKey) throw new LlmConfigError("deepseek", "DEEPSEEK_API_KEY is not set");
    this.apiKey = apiKey;
    this.base = (opts.baseUrl ?? loadEnv().DEEPSEEK_BASE_URL).replace(/\/$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retry = opts.retry;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const body: Record<string, unknown> = { model: req.model, messages: req.messages, stream: false };
    if (req.tools?.length) {
      body.tools = req.tools;
      if (req.toolChoice) body.tool_choice = req.toolChoice;
    }
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

    const timeoutMs = req.timeoutMs ?? this.timeoutMs;
    const res = await requestWithRetry(
      `${this.base}/chat/completions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
      },
      { provider: "deepseek", fetchFn: this.fetchFn, timeoutMs, signal: req.signal, retry: this.retry },
    );

    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      // The body stream shares the attempt's abort signal.
      if (req.signal?.aborted) throw e;
      throw new LlmTimeoutError("deepseek", timeoutMs);
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmResponseError("deepseek", `invalid JSON: ${text}`);
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw new LlmResponseError("deepseek", parsed.error.message);

    const choice = parsed.data.choices[0]!;
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.function.name, arguments: c.function.arguments ?? "" },
    }));
    const message: AssistantMessage = { role: "assistant", content: choice.message.content ?? null };
    if (toolCalls.length) message.tool_calls = toolCalls;
    const u = parsed.data.usage;
    return {
      message,
      toolCalls,
      finishReason: choice.finish_reason ?? "stop",
      usage: { promptTokens: u?.prompt_tokens ?? 0, completionTokens: u?.completion_tokens ?? 0, totalTokens: u?.total_tokens ?? 0 },
      ...(choice.message.reasoning_content ? { reasoning: choice.message.reasoning_content } : {}),
      model: parsed.data.model ?? req.model,
    };
  }
}

export interface CreateLlmClientOptions extends DeepSeekClientOptions {
  /** Defaults to LLM_PROVIDER. */
  provider?: "deepseek" | "anthropic";
}

/** Client for the configured provider. Reads env only for values not passed in. */
export function createLlmClient(opts: CreateLlmClientOptions = {}): LlmClient {
  const provider = opts.provider ?? loadEnv().LLM_PROVIDER;
  if (provider === "deepseek") return new DeepSeekClient(opts);
  // TODO(anthropic): implement an AnthropicClient behind the same LlmClient interface (map
  // ChatMessage/ToolDefinition to the Messages API: system prompt, tool_use/tool_result blocks).
  // Load the `claude-api` skill before writing any Anthropic SDK code. Not built: DeepSeek is
  // the chosen provider (docs/STATUS.md, Decisions, 2026-10-09).
  throw new LlmConfigError("anthropic", "LLM_PROVIDER=anthropic is not implemented yet; use deepseek");
}
