// Shared fetch mocks for the llm tests. No test in this package touches the network.

export type Call = { url: string; init: RequestInit };

export type Reply = { status?: number; body: unknown; headers?: Record<string, string> };

/** Replies in order; the last one repeats. Records every call. */
export function scriptedFetch(replies: Reply[], calls: Call[] = []): typeof fetch {
  let i = 0;
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies[Math.min(i++, replies.length - 1)]!;
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
}

let n = 0;
/** An OpenAI-shaped chat completion. */
export function completion(opts: { content?: string | null; toolCalls?: { name: string; args: unknown }[]; finish?: string }) {
  const tool_calls = opts.toolCalls?.map((c) => ({
    id: `call_${++n}`,
    type: "function",
    function: { name: c.name, arguments: typeof c.args === "string" ? c.args : JSON.stringify(c.args) },
  }));
  return {
    id: "cmpl",
    object: "chat.completion",
    model: "deepseek-flash",
    choices: [
      {
        index: 0,
        finish_reason: opts.finish ?? (tool_calls ? "tool_calls" : "stop"),
        message: { role: "assistant", content: opts.content ?? null, ...(tool_calls ? { tool_calls } : {}) },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

export const noSleep = { sleep: async () => {} };

export const bodyOf = (c: Call) => JSON.parse(c.init.body as string) as Record<string, any>;
