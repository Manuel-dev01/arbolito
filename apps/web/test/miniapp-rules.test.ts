import { afterEach, describe, expect, it, vi } from "vitest";
import type { Address } from "viem";
import { cancelText } from "@arbolito/rules";
import { ChatResponse, RulesListResponse } from "../src/lib/miniapp/contract";
import { chatTurn } from "../src/lib/miniapp/server/chat";
import { setDeps } from "../src/lib/miniapp/server/deps";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { cancelRuleReq, confirmRule, draftRule, listRulesRes } from "../src/lib/miniapp/server/rules";
import { ACCOUNT, OTHER, ScriptedLlm, T0, makeRig, wallet } from "./miniapp-helpers";

const GUARD = "0x411E44dB70476F74C3560F5cCFdbc8c63f231d33" as Address;
const OPERATOR = "0xeA7135ec38D6C289D781D22059eCf6007c6f36b4" as Address;
const MAMA = "0x2222222222222222222222222222222222222222" as Address;
const EXPIRY = BigInt(T0 / 1000 + 30 * 86_400);

/** A rig whose account has autonomy on with Mamá as an allowed contact. */
function autonomous(opts: { contact?: boolean; operator?: Address } = {}) {
  const rig = makeRig({ guard: { address: GUARD, operator: OPERATOR } });
  rig.chain.reads = {
    settings: () => [true, false, 50],
    operatorOf: () => [opts.operator ?? OPERATOR, EXPIRY, true],
    isRecipient: (a) => (opts.contact ?? true) && (a[1] as string).toLowerCase() === MAMA.toLowerCase(),
  };
  return rig;
}

async function failure(p: Promise<unknown>): Promise<ApiFailure> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  throw new Error("expected an ApiFailure");
}

const SEND = { kind: "send" as const, params: { contact: MAMA, contactName: "Mamá", amountUsdt: "5000000", receive: "wARS" as const, dayOfMonth: 1 } };

afterEach(() => {
  vi.restoreAllMocks();
  setDeps(undefined);
});

describe("standing rules (Mini App backend)", () => {
  it("drafts only with autonomy on and an allowed contact", async () => {
    expect((await failure(draftRule(makeRig({ guard: undefined }).deps, ACCOUNT, "es", SEND))).code).toBe("not_ready");
    expect((await failure(draftRule(autonomous({ operator: OTHER }).deps, ACCOUNT, "es", SEND))).message).toContain("Turn on");
    expect((await failure(draftRule(autonomous({ contact: false }).deps, ACCOUNT, "es", SEND))).message).toContain("contact");
    const card = await draftRule(autonomous().deps, ACCOUNT, "es", SEND);
    expect(card).toMatchObject({ status: "draft", kind: "send", description: "Cada mes, el día 1: enviar US$ 5,00 a Mamá, que recibe pesos (wARS)." });
    expect(card.message).toContain(`ID: ${card.ruleId}`);
  });

  it("turns on only with the account's own signature over the exact text, once", async () => {
    const rig = autonomous();
    const card = await draftRule(rig.deps, ACCOUNT, "es", SEND);
    const wrong = await wallet.signMessage({ message: card.message + " " });
    expect((await failure(confirmRule(rig.deps, { ruleId: card.ruleId, account: ACCOUNT, signature: wrong }))).message).toContain("signature");
    expect((await failure(confirmRule(rig.deps, { ruleId: card.ruleId, account: OTHER, signature: wrong }))).status).toBe(404);

    const sig = await wallet.signMessage({ message: card.message });
    const on = await confirmRule(rig.deps, { ruleId: card.ruleId, account: ACCOUNT, signature: sig });
    expect(on.rule).toMatchObject({ status: "active", nextRunAt: "2026-11-01T13:00:00.000Z" });
    expect((await failure(confirmRule(rig.deps, { ruleId: card.ruleId, account: ACCOUNT, signature: sig }))).status).toBe(409);
  });

  it("cancels with a signature over the cancel text, and lists the account's rules", async () => {
    const rig = autonomous();
    const card = await draftRule(rig.deps, ACCOUNT, "en", { kind: "split", params: { percent: 30, to: "wARS", minIncomingUsdt: "20000000" } });
    await confirmRule(rig.deps, { ruleId: card.ruleId, account: ACCOUNT, signature: await wallet.signMessage({ message: card.message }) });
    const listed = RulesListResponse.parse(await listRulesRes(rig.deps, ACCOUNT));
    expect(listed.rules.map((r) => [r.kind, r.status, r.description])).toEqual([["split", "active", "When at least US$ 20.00 arrives, change 30% into pesos (wARS)."]]);

    const bad = await wallet.signMessage({ message: cancelText(card.ruleId, OTHER) });
    expect((await failure(cancelRuleReq(rig.deps, { ruleId: card.ruleId, account: ACCOUNT, signature: bad }))).message).toContain("signature");
    await cancelRuleReq(rig.deps, { ruleId: card.ruleId, account: ACCOUNT, signature: await wallet.signMessage({ message: cancelText(card.ruleId, ACCOUNT) }) });
    expect((await listRulesRes(rig.deps, ACCOUNT)).rules).toEqual([]);
  });

  it("the chat drafts a monthly send to a phone contact by name and returns it as a card", async () => {
    const rig = autonomous();
    rig.llm = new ScriptedLlm([
      { toolCalls: [{ name: "prepare_scheduled_send", args: { contact: "mama", amountUsd: "5", receive: "wARS", dayOfMonth: 1 } }] },
      { content: "Listo: firmá la regla en MiniPay." },
    ]);
    rig.deps.llm = () => rig.llm;
    const res = ChatResponse.parse(await chatTurn(rig.deps, { account: ACCOUNT, lang: "es", text: "mandale 5 dólares en pesos a mamá cada día 1", contacts: [{ name: "Mamá", address: MAMA }] }, "1.1.1.1"));
    expect(res.rules).toHaveLength(1);
    expect(res.rules[0]).toMatchObject({ kind: "send", status: "draft" });
    expect(rig.store.rules[0]).toMatchObject({ account: ACCOUNT, status: "draft" });

    // An unknown name gets the saved names back, and nothing is drafted.
    rig.llm = new ScriptedLlm([{ toolCalls: [{ name: "prepare_scheduled_send", args: { contact: "Pedro", amountUsd: "5", dayOfMonth: 1 } }] }, { content: "No encuentro a Pedro." }]);
    rig.deps.llm = () => rig.llm;
    const miss = await chatTurn(rig.deps, { account: ACCOUNT, lang: "es", text: "mandale a Pedro", contacts: [{ name: "Mamá", address: MAMA }] }, "1.1.1.1");
    expect(miss.rules).toEqual([]);
    const tool = rig.llm.requests[1]!.messages.filter((m) => m.role === "tool").at(-1)!;
    expect(String(tool.content)).toContain("Saved: Mamá");
  });
});
