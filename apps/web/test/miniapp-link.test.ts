import { afterEach, describe, expect, it } from "vitest";
import { POST as linkRoute } from "../src/app/api/miniapp/link/confirm/route";
import { LinkConfirmResponse } from "../src/lib/miniapp/contract";
import { setDeps } from "../src/lib/miniapp/server/deps";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { confirmLink, linkStatus } from "../src/lib/miniapp/server/link";
import { ACCOUNT, T0, makeRig } from "./miniapp-helpers";

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

describe("POST /link/confirm", () => {
  it("links the wallet (lowercased) to the Telegram user and burns the code", async () => {
    const rig = makeRig();
    const tg = rig.store.addUser({ telegramId: 42n, telegramUsername: "ola", displayName: "Ola" });
    rig.store.addCode({ code: "1234", userId: tg.id });
    const res = await confirmLink(rig.deps, { code: "1234", account: ACCOUNT.toUpperCase().replace("0X", "0x") }, "1.1.1.1");
    expect(res).toEqual({ linked: true, telegramName: "Ola" });
    expect(rig.store.users.find((u) => u.id === tg.id)!.walletAddress).toBe(ACCOUNT);
    expect(rig.store.codes[0]).toMatchObject({ usedAt: new Date(T0), account: ACCOUNT });
    // Single use.
    expect((await failure(confirmLink(rig.deps, { code: "1234", account: ACCOUNT }, "1.1.1.1"))).code).toBe("bad_request");
  });

  it("merges an existing MiniPay-only user: receipts and messages move, the duplicate goes", async () => {
    const rig = makeRig();
    const mini = await rig.store.walletUser(ACCOUNT);
    await rig.store.appendHistory(mini.id, [{ role: "user", content: "hola" }, { role: "assistant", content: "¡Hola!" }]);
    await rig.store.insertReceipt({
      id: crypto.randomUUID(),
      userId: mini.id,
      bundleHash: "0xhash",
      bundle: {},
      tokenIn: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
      tokenOut: "0x0DC4F92879B7670e5f4e4e6e3c801D229129D90D",
      amountIn: "1",
      amountOut: "1",
      usdMicros: "1",
      taker: ACCOUNT,
      executionTx: `0x${"12".repeat(32)}`,
      executionBlock: 1n,
    });
    const tg = rig.store.addUser({ telegramId: 7n, telegramUsername: "lucia" });
    rig.store.addCode({ code: "0420", userId: tg.id });

    expect(await confirmLink(rig.deps, { code: "0420", account: ACCOUNT }, "1.1.1.1")).toEqual({ linked: true, telegramName: "@lucia" });
    expect(rig.store.users.map((u) => u.id)).toEqual([tg.id]);
    expect(rig.store.users[0]!.walletAddress).toBe(ACCOUNT);
    expect(rig.store.receipts[0]!.userId).toBe(tg.id);
    expect(rig.store.messages.map((m) => m.userId)).toEqual([tg.id, tg.id]);
  });

  it("refuses a wallet already linked to another Telegram account, and expired or unknown codes", async () => {
    const rig = makeRig();
    rig.store.addUser({ telegramId: 1n, walletAddress: ACCOUNT });
    const tg = rig.store.addUser({ telegramId: 2n });
    rig.store.addCode({ code: "1111", userId: tg.id });
    rig.store.addCode({ code: "2222", userId: tg.id, expiresAt: new Date(T0 - 1) });
    const taken = await failure(confirmLink(rig.deps, { code: "1111", account: ACCOUNT }, "1.1.1.1"));
    expect([taken.code, taken.status]).toEqual(["bad_request", 409]);
    expect(rig.store.codes[0]!.usedAt).toBeNull(); // nothing burned on refusal
    expect((await failure(confirmLink(rig.deps, { code: "2222", account: "0x5555555555555555555555555555555555555555" }, "1.1.1.1"))).message).toContain("expired");
    expect((await failure(confirmLink(rig.deps, { code: "9999", account: "0x5555555555555555555555555555555555555555" }, "1.1.1.1"))).code).toBe("bad_request");
  });

  it("rate-limits code guessing per wallet", async () => {
    const rig = makeRig();
    setDeps(rig.deps);
    const call = () =>
      linkRoute(new Request("https://arbolito.test/api/miniapp/link/confirm", { method: "POST", body: JSON.stringify({ code: "0000", account: ACCOUNT }), headers: { "x-forwarded-for": "9.9.9.9" } }));
    for (let i = 0; i < 5; i++) expect((await call()).status).toBe(400);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe("rate_limited");
    rig.clock.now += 10 * 60_000;
    expect((await call()).status).toBe(400);
  });

  it("route handler returns the contract shape", async () => {
    const rig = makeRig();
    const tg = rig.store.addUser({ telegramId: 3n });
    rig.store.addCode({ code: "5555", userId: tg.id });
    setDeps(rig.deps);
    const res = await linkRoute(new Request("https://arbolito.test/x", { method: "POST", body: JSON.stringify({ code: "5555", account: ACCOUNT }) }));
    expect(res.status).toBe(200);
    expect(LinkConfirmResponse.parse(await res.json())).toEqual({ linked: true, telegramName: null });
  });
});

describe("GET /link/status", () => {
  it("says whether a Telegram user owns the wallet, and under which name", async () => {
    const rig = makeRig();
    expect(await linkStatus(rig.deps, ACCOUNT)).toEqual({ linked: false, telegramName: null });
    rig.store.addUser({ walletAddress: ACCOUNT }); // a MiniPay-only user: not linked
    expect((await linkStatus(rig.deps, ACCOUNT)).linked).toBe(false);
    rig.store.users[0]!.telegramId = 5117427566n;
    rig.store.users[0]!.telegramUsername = "ola_nuell";
    expect(await linkStatus(rig.deps, ACCOUNT)).toEqual({ linked: true, telegramName: "@ola_nuell" });
  });
});
