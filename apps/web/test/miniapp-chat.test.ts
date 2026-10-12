import { afterEach, describe, expect, it } from "vitest";
import { TOKENS } from "@arbolito/config";
import { LlmApiError } from "@arbolito/llm";
import { POST as chatRoute } from "../src/app/api/miniapp/chat/route";
import { ChatResponse } from "../src/lib/miniapp/contract";
import { chatTurn } from "../src/lib/miniapp/server/chat";
import { setDeps } from "../src/lib/miniapp/server/deps";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { ACCOUNT, ScriptedLlm, makeRig } from "./miniapp-helpers";

async function failure(p: Promise<unknown>): Promise<ApiFailure> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  throw new Error("expected an ApiFailure");
}

afterEach(() => setDeps(undefined));

describe("POST /chat (fake LLM, fake STT)", () => {
  it("runs a tool turn: prepare_convert stores a quote and returns it as a card", async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ name: "prepare_convert", args: { from: "USDT", to: "wARS", amount: "10" } }] },
      { content: "Te consigo ARS 16.000 por 10 USDT. Revisá la tarjeta y confirmá." },
    ]);
    const rig = makeRig({ llm: () => llm });
    const res = ChatResponse.parse(await chatTurn(rig.deps, { account: ACCOUNT, lang: "es", text: "cambiá 10 dólares a pesos" }, "1.1.1.1"));
    expect(res.transcript).toBeNull();
    expect(res.reply).toContain("Revisá la tarjeta");
    expect(res.quotes).toHaveLength(1);
    expect(res.quotes[0]).toMatchObject({ from: "USDT", to: "wARS", amountIn: "10000000" });
    expect(rig.store.quotes[0]).toMatchObject({ id: res.quotes[0]!.quoteId, account: ACCOUNT });

    // Tool output fed back to the model: pending, nothing moved.
    const toolMsg = llm.requests[1]!.messages.find((m) => m.role === "tool")!;
    expect(JSON.parse(toolMsg.content as string)).toMatchObject({ status: "pending_confirmation", youPay: "10 USDT" });
    // Only the Mini App tool set is offered (no send or contacts).
    expect(llm.requests[0]!.tools!.map((t) => t.function.name).sort()).toEqual(
      ["deposit_info", "get_balances", "get_limits", "get_quote", "help", "prepare_convert", "withdraw_guide"].sort(),
    );

    // History: a MiniPay-only user keyed by the wallet, and the turn stored.
    const user = rig.store.users.find((u) => u.walletAddress === ACCOUNT)!;
    expect(user.telegramId).toBeNull();
    expect(rig.store.messages.filter((m) => m.userId === user.id).map((m) => m.content.role)).toEqual(["user", "assistant", "tool", "assistant"]);

    // The next turn sees that history.
    await chatTurn(rig.deps, { account: ACCOUNT, lang: "es", text: "gracias" }, "1.1.1.1");
    const next = llm.requests[2]!.messages.map((m) => m.role);
    expect(next).toEqual(["system", "user", "assistant", "tool", "assistant", "user"]);
  });

  it("answers balances from the chain and keeps going when a quote has no route", async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ name: "get_balances", args: {} }, { name: "get_quote", args: { from: "USDC", to: "wBRL", amount: "5" } }] },
      { content: "Tenés 12,5 USDT." },
    ]);
    const rig = makeRig({ llm: () => llm });
    rig.chain.balances.set(`${TOKENS.USDT.address}:${ACCOUNT}`.toLowerCase(), 12_500_000n);
    const res = await chatTurn(rig.deps, { account: ACCOUNT, lang: "es", text: "¿cuánto tengo?" }, "1.1.1.1");
    expect(res.quotes).toEqual([]);
    const tools = llm.requests[1]!.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content as string));
    expect(tools[0].balances).toContainEqual({ token: "USDT", amount: "12.5 USDT" });
    expect(tools[1]).toMatchObject({ error: "no_route" });
  });

  it("transcribes a voice note with the injected STT", async () => {
    const llm = new ScriptedLlm([{ content: "Dale." }]);
    const rig = makeRig({ llm: () => llm });
    const res = await chatTurn(rig.deps, { account: ACCOUNT, lang: "es", audioBase64: Buffer.from("fake-ogg").toString("base64"), audioMime: "audio/ogg; codecs=opus" }, "1.1.1.1");
    expect(res.transcript).toBe("cambiá 10 dólares a pesos");
    expect(rig.transcripts).toEqual([{ bytes: 8, mimeType: "audio/ogg" }]);
    expect(llm.requests[0]!.messages.at(-1)).toEqual({ role: "user", content: "cambiá 10 dólares a pesos" });
  });

  it("rate-limits per wallet and maps LLM failures to upstream", async () => {
    const rig = makeRig();
    for (let i = 0; i < 8; i++) await chatTurn(rig.deps, { account: ACCOUNT, lang: "en", text: "hi" }, "1.1.1.1");
    expect((await failure(chatTurn(rig.deps, { account: ACCOUNT, lang: "en", text: "hi" }, "1.1.1.1"))).code).toBe("rate_limited");

    const down = makeRig({
      llm: () => ({
        chat: async () => {
          throw new LlmApiError("deepseek", 503, "overloaded");
        },
      }),
    });
    const f = await failure(chatTurn(down.deps, { account: ACCOUNT, lang: "en", text: "hi" }, "1.1.1.1"));
    expect([f.code, f.status]).toEqual(["upstream", 502]);
  });

  it("route handler: empty request is a bad_request", async () => {
    setDeps(makeRig().deps);
    const res = await chatRoute(new Request("https://arbolito.test/x", { method: "POST", body: JSON.stringify({ account: ACCOUNT, lang: "es" }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });
});
