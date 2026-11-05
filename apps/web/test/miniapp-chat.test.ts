import { decodeFunctionData } from "viem";
import { erc20Abi } from "@arbolito/router";
import { prepareQuote } from "../src/lib/miniapp/server/prepare";
import { openQuote } from "../src/lib/miniapp/server/quote";
import { prepareSend } from "../src/lib/miniapp/server/send";
import { afterEach, describe, expect, it } from "vitest";
import { TOKENS } from "@arbolito/config";
import { LlmApiError } from "@arbolito/llm";
import { POST as chatRoute } from "../src/app/api/miniapp/chat/route";
import { ChatResponse } from "../src/lib/miniapp/contract";
import { chatTurn } from "../src/lib/miniapp/server/chat";
import { setDeps } from "../src/lib/miniapp/server/deps";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { ACCOUNT, OTHER, ScriptedLlm, makeRig } from "./miniapp-helpers";

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
  it("looks up a saved number label and drafts all spendable dollars without sending", async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ name: "list_contacts", args: {} }, { name: "get_balances", args: {} }] },
      { toolCalls: [{ name: "prepare_send", args: { recipient: "1st MTN Number", token: "USDT", amount: "59.4187" } }] },
      { content: "Review the send to 1st MTN Number, then confirm in MiniPay." },
    ]);
    const rig = makeRig({ llm: () => llm });
    rig.chain.balances.set(`${TOKENS.USDT.address}:${ACCOUNT}`.toLowerCase(), 59_468_700n);
    const res = ChatResponse.parse(await chatTurn(rig.deps, { account: ACCOUNT, lang: "en", text: "Send all my dollars to my saved 1st MTN Number", contacts: [{ name: "1st MTN Number", address: OTHER, receive: "USDT" }] }, "1.1.1.1"));
    const tools = llm.requests[1]!.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content as string));
    expect(tools[0].contacts[0].name).toBe("1st MTN Number");
    expect(tools[1].maximumSend.USDT).toBe("59.4187");
    expect(res.quotes).toEqual([]); // a send never becomes a conversion to self
    expect(res.sends).toHaveLength(1);
    expect(res.sends[0]).toMatchObject({ recipient: OTHER, recipientName: "1st MTN Number", from: "USDT", to: "USDT", amount: "59.4187", quote: null });
    expect(rig.chain.txs.size).toBe(0);
    const draft = res.sends[0]!;
    const prepared = await prepareSend(rig.deps, { account: ACCOUNT, recipient: draft.recipient, from: draft.from, to: draft.to, amount: draft.amount });
    const decoded = decodeFunctionData({ abi: erc20Abi, data: prepared.calls[0]!.data as `0x${string}` });
    expect(decoded).toMatchObject({ functionName: "transfer", args: [OTHER, 59_418_700n] });
    expect(rig.chain.txs.size).toBe(0); // even preparation does not broadcast
  });

  it("keeps a cross-currency send bound to its saved recipient and exact token pair", async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ name: "prepare_send", args: { recipient: "mama", token: "USDT", amount: "2" } }] },
      { content: "Review the payment to Mamá." },
    ]);
    const rig = makeRig({ llm: () => llm });
    rig.chain.balances.set(`${TOKENS.USDT.address}:${ACCOUNT}`.toLowerCase(), 10_000_000n);
    const res = await chatTurn(rig.deps, { account: ACCOUNT, lang: "en", text: "Send two dollars to mama", contacts: [{ name: "Mamá", address: OTHER, receive: "wARS" }] }, "1.1.1.1");
    expect(res.quotes).toEqual([]);
    expect(res.sends[0]).toMatchObject({ recipient: OTHER, from: "USDT", to: "wARS", quote: { from: "USDT", to: "wARS", amountIn: "2000000" } });
    expect(rig.store.quotes[0]!.prepared).toBeNull();
    expect((await openQuote(rig.deps, ACCOUNT)).quote).toBeNull(); // never resume this as a conversion to self
    const quoteId = res.sends[0]!.quote!.quoteId;
    expect((await failure(prepareQuote(rig.deps, { account: ACCOUNT, quoteId }))).code).toBe("bad_request");
    expect(rig.store.quotes[0]!.prepared).toBeNull();
    const prepared = await prepareSend(rig.deps, { account: ACCOUNT, recipient: OTHER, from: "USDT", to: "wARS", amount: "2", quoteId });
    expect(prepared.quoteId).toBe(quoteId);
  });

  it.each(["unknown", "ambiguous", "untyped-address", "fee-reserve", "missing-wallet"])("does not draft unsafe sends: %s", async (scenario) => {
    const recipient = scenario === "untyped-address" ? OTHER : scenario === "unknown" ? "Unknown" : "Emmanuel";
    const llm = new ScriptedLlm([{ toolCalls: [{ name: "prepare_send", args: { recipient, token: "USDT", amount: "10" } }] }, { content: "Please check the recipient and amount." }]);
    const rig = makeRig({ llm: () => llm });
    rig.chain.balances.set(`${TOKENS.USDT.address}:${ACCOUNT}`.toLowerCase(), 10_000_000n);
    const contacts = [{ name: "Emmanuel", address: scenario === "missing-wallet" ? null : OTHER }, ...(scenario === "ambiguous" ? [{ name: "Emmanuel", address: ACCOUNT }] : [])];
    const res = await chatTurn(rig.deps, { account: ACCOUNT, lang: "en", text: "Send my dollars", contacts }, "1.1.1.1");
    expect(res.sends).toEqual([]);
    const error = JSON.parse(llm.requests[1]!.messages.find((m) => m.role === "tool")!.content as string);
    expect(error.error).toBe(scenario === "fee-reserve" ? "fee_reserve" : "bad_request");
    expect(rig.chain.txs.size).toBe(0);
  });

  it("explains a staged route and prepares only its first dollar card", async () => {
    const args = { from: "wARS", to: "wBRL", amount: "6600" };
    const llm = new ScriptedLlm([
      { toolCalls: [{ name: "get_quote", args }, { name: "prepare_convert", args }] },
      { content: "First confirm the dollar card. The second conversion gets a fresh rate." },
    ]);
    const rig = makeRig({ llm: () => llm });
    rig.textileVenue.pairs["USDT>wBRL"] = (a) => a * 6n * 10n ** 12n;
    const res = await chatTurn(rig.deps, { account: ACCOUNT, lang: "en", text: "Change 6600 pesos to reais" }, "1.1.1.1");
    const tools = llm.requests[1]!.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content as string));
    expect(tools[0]).toMatchObject({ status: "two_steps_required", finalDestination: "wBRL" });
    expect(tools[1]).toMatchObject({ status: "pending_first_step", finalDestination: "wBRL" });
    expect(res.quotes).toHaveLength(1);
    expect(res.quotes[0]).toMatchObject({ from: "wARS", to: "USDT" });
    expect(rig.store.quotes).toHaveLength(1);
  });
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
    // MiniPay chat offers contact lookup, recipient-bound sends and rule drafts.
    expect(llm.requests[0]!.tools!.map((t) => t.function.name).sort()).toEqual(
      ["list_contacts", "prepare_send", "deposit_info", "get_balances", "get_limits", "get_quote", "help", "list_rules", "prepare_convert", "prepare_payday_split", "prepare_peso_guardian", "prepare_scheduled_send", "withdraw_guide"].sort(),
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
