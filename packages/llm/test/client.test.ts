import { describe, expect, it } from "vitest";
import { DeepSeekClient, LlmApiError, LlmConfigError, LlmResponseError, LlmTimeoutError, createLlmClient, toolDefinitions } from "../src";
import { bodyOf, completion, noSleep, scriptedFetch, type Call } from "./helpers";

const KEY = "sk-test-not-a-real-key";
const opts = (fetchFn: typeof fetch, extra: object = {}) => ({ apiKey: KEY, baseUrl: "https://api.deepseek.com", fetchFn, retry: noSleep, ...extra });

describe("DeepSeekClient.chat", () => {
  it("sends an OpenAI-compatible request with auth, model and tools", async () => {
    const calls: Call[] = [];
    const c = new DeepSeekClient(opts(scriptedFetch([{ body: completion({ content: "hola" }) }], calls)));
    const tools = toolDefinitions(["get_quote"]);
    const res = await c.chat({
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hola" }],
      tools,
      toolChoice: "auto",
      temperature: 0.3,
      maxTokens: 400,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.deepseek.com/chat/completions");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers["content-type"]).toBe("application/json");
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(bodyOf(calls[0]!)).toEqual({
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hola" }],
      stream: false,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 400,
    });

    expect(res.message).toEqual({ role: "assistant", content: "hola" });
    expect(res.toolCalls).toEqual([]);
    expect(res.finishReason).toBe("stop");
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it("omits tools and tool_choice when no tools are given", async () => {
    const calls: Call[] = [];
    const c = new DeepSeekClient(opts(scriptedFetch([{ body: completion({ content: "ok" }) }], calls)));
    await c.chat({ model: "deepseek-flash", messages: [{ role: "user", content: "x" }], toolChoice: "auto" });
    expect(bodyOf(calls[0]!)).not.toHaveProperty("tools");
    expect(bodyOf(calls[0]!)).not.toHaveProperty("tool_choice");
  });

  it("parses tool calls and keeps reasoning out of the message", async () => {
    const body = completion({ toolCalls: [{ name: "get_quote", args: { from: "USDT", to: "wARS", amount: "200" } }] });
    (body.choices[0]!.message as Record<string, unknown>).reasoning_content = "thinking…";
    const c = new DeepSeekClient(opts(scriptedFetch([{ body }])));
    const res = await c.chat({ model: "deepseek-v4-pro", messages: [{ role: "user", content: "x" }] });
    expect(res.finishReason).toBe("tool_calls");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]!.function.name).toBe("get_quote");
    expect(JSON.parse(res.toolCalls[0]!.function.arguments)).toEqual({ from: "USDT", to: "wARS", amount: "200" });
    expect(res.message.tool_calls).toEqual(res.toolCalls);
    expect(res.reasoning).toBe("thinking…");
    expect(res.message).not.toHaveProperty("reasoning_content");
  });

  it("retries 429 (honouring Retry-After) and then succeeds", async () => {
    const calls: Call[] = [];
    const waits: number[] = [];
    const fetchFn = scriptedFetch(
      [
        { status: 429, body: { error: "rate limited" }, headers: { "retry-after": "2" } },
        { status: 503, body: "busy" },
        { body: completion({ content: "listo" }) },
      ],
      calls,
    );
    const c = new DeepSeekClient(opts(fetchFn, { retry: { sleep: async (ms: number) => void waits.push(ms) } }));
    const res = await c.chat({ model: "deepseek-flash", messages: [{ role: "user", content: "x" }] });
    expect(res.message.content).toBe("listo");
    expect(calls).toHaveLength(3);
    expect(waits[0]).toBe(2000);
    expect(waits[1]).toBeGreaterThanOrEqual(1000); // 500 * 2^1 + jitter
  });

  it("gives up after 2 retries with a typed error", async () => {
    const calls: Call[] = [];
    const c = new DeepSeekClient(opts(scriptedFetch([{ status: 429, body: "slow down" }], calls)));
    const err = await c.chat({ model: "deepseek-flash", messages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmApiError);
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(calls).toHaveLength(3);
    expect(String(err.message)).not.toContain(KEY);
  });

  it("does not retry a 400", async () => {
    const calls: Call[] = [];
    const c = new DeepSeekClient(opts(scriptedFetch([{ status: 400, body: { error: { message: "bad model" } } }], calls)));
    const err = await c.chat({ model: "nope", messages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmApiError);
    expect(err.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it("times out via AbortSignal and retries, then throws LlmTimeoutError", async () => {
    let attempts = 0;
    const hang = ((_url: string, init: RequestInit) => {
      attempts++;
      return new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
    }) as unknown as typeof fetch;
    const c = new DeepSeekClient(opts(hang, { timeoutMs: 20 }));
    const err = await c.chat({ model: "deepseek-flash", messages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmTimeoutError);
    expect(attempts).toBe(3);
  });

  it("does not retry when the caller aborts", async () => {
    let attempts = 0;
    const hang = ((_url: string, init: RequestInit) => {
      attempts++;
      return new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)));
    }) as unknown as typeof fetch;
    const c = new DeepSeekClient(opts(hang));
    const ac = new AbortController();
    const p = c.chat({ model: "deepseek-flash", messages: [], signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeDefined();
    expect(attempts).toBe(1);
  });

  it("rejects a malformed 200 body", async () => {
    const c = new DeepSeekClient(opts(scriptedFetch([{ body: { choices: [] } }])));
    await expect(c.chat({ model: "deepseek-flash", messages: [] })).rejects.toBeInstanceOf(LlmResponseError);
  });
});

describe("createLlmClient", () => {
  it("builds a DeepSeek client for provider deepseek", () => {
    expect(createLlmClient({ provider: "deepseek", apiKey: KEY, baseUrl: "https://api.deepseek.com" })).toBeInstanceOf(DeepSeekClient);
  });

  it("fails clearly for anthropic (not implemented)", () => {
    expect(() => createLlmClient({ provider: "anthropic" })).toThrow(LlmConfigError);
  });

  it("requires an API key", () => {
    expect(() => new DeepSeekClient({ apiKey: "", baseUrl: "https://api.deepseek.com" })).toThrow(/DEEPSEEK_API_KEY/);
  });
});
