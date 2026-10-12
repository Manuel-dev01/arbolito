import { describe, expect, it } from "vitest";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { POOLS, TOKENS } from "@arbolito/config";
import { arbolitoGuardAbi, attributionCodes } from "@arbolito/chain";
import { erc20Abi } from "@arbolito/router";
import { AutonomyStatus, CallsResponse } from "../src/lib/miniapp/contract";
import { autonomyPlan, autonomyRevokePlan, autonomyStatus } from "../src/lib/miniapp/server/autonomy";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { ACCOUNT, CODE, T0, makeRig } from "./miniapp-helpers";

const GUARD = "0x9999999999999999999999999999999999999999" as Address;
const OPERATOR = "0x8888888888888888888888888888888888888888" as Address;
const CONTACT = "0x7777777777777777777777777777777777777777" as Address;
const guarded = () => makeRig({ guard: { address: GUARD, operator: OPERATOR } });

async function failure(p: Promise<unknown>): Promise<ApiFailure> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  throw new Error("expected an ApiFailure");
}

describe("autonomy plan", () => {
  it("encodes bounded approvals, setOperator(expiry) and configure, all tagged", async () => {
    const rig = guarded();
    const res = CallsResponse.parse(
      await autonomyPlan(rig.deps, {
        account: ACCOUNT,
        limits: [
          { sym: "USDT", perTx: "20000000", perDay: "50000000" },
          { sym: "wARS", perTx: (30_000n * 10n ** 18n).toString(), perDay: (80_000n * 10n ** 18n).toString() },
        ],
        contacts: [CONTACT, CONTACT.toUpperCase().replace("0X", "0x")],
        maxSlippageBps: 100,
        operatorDays: 30,
      }),
    );
    expect(res.calls.map((c) => c.to)).toEqual([TOKENS.USDT.address, TOKENS.wARS.address, GUARD, GUARD]);
    for (const c of res.calls) {
      expect(attributionCodes(c.data as Hex)).toContain(CODE);
      expect(c.value).toBe("0");
    }
    expect(decodeFunctionData({ abi: erc20Abi, data: res.calls[0]!.data as Hex })).toMatchObject({ functionName: "approve", args: [GUARD, 50_000_000n] });
    expect(decodeFunctionData({ abi: erc20Abi, data: res.calls[1]!.data as Hex }).args).toEqual([GUARD, 80_000n * 10n ** 18n]);

    const setOp = decodeFunctionData({ abi: arbolitoGuardAbi, data: res.calls[2]!.data as Hex });
    expect(setOp).toMatchObject({ functionName: "setOperator", args: [OPERATOR, BigInt(T0 / 1000 + 30 * 86_400)] });

    const cfg = decodeFunctionData({ abi: arbolitoGuardAbi, data: res.calls[3]!.data as Hex });
    expect(cfg.functionName).toBe("configure");
    const c = cfg.args![0] as {
      account: Address;
      paused: boolean;
      maxSlippageBps: number;
      limits: { token: Address; maxPerTx: bigint; maxPerDay: bigint }[];
      recipients: { recipient: Address; allowed: boolean }[];
      prices: unknown[];
    };
    expect(c.account.toLowerCase()).toBe(ACCOUNT);
    expect([c.paused, c.maxSlippageBps, c.prices]).toEqual([false, 100, []]);
    expect(c.limits).toEqual([
      { token: TOKENS.USDT.address, maxPerTx: 20_000_000n, maxPerDay: 50_000_000n },
      { token: TOKENS.wARS.address, maxPerTx: 30_000n * 10n ** 18n, maxPerDay: 80_000n * 10n ** 18n },
    ]);
    expect(c.recipients).toEqual([{ recipient: CONTACT, allowed: true }]); // de-duplicated
  });

  it("rejects bad limits and contacts the guard would revert on", async () => {
    const rig = guarded();
    const base = { account: ACCOUNT, contacts: [] as string[], maxSlippageBps: 50, operatorDays: 7 };
    const plan = (over: object) => failure(autonomyPlan(rig.deps, { ...base, limits: [{ sym: "USDT", perTx: "1", perDay: "2" }], ...over }));
    expect((await plan({ limits: [{ sym: "USDT", perTx: "3", perDay: "2" }] })).message).toContain("above the daily");
    expect((await plan({ limits: [{ sym: "USDT", perTx: "0", perDay: "2" }] })).code).toBe("bad_request");
    expect((await plan({ limits: [{ sym: "USDT", perTx: "1", perDay: "2" }, { sym: "USDT", perTx: "1", perDay: "2" }] })).message).toContain("twice");
    expect((await plan({ contacts: [POOLS[0].address] })).message).toContain("can't be an autonomy contact");
    expect((await plan({ contacts: [TOKENS.USDC.address] })).code).toBe("bad_request");
    expect((await plan({ contacts: [GUARD] })).code).toBe("bad_request");
  });

  it("answers not_ready until GUARD_ADDRESS and ARBOLITO_OPERATOR_ADDRESS are set", async () => {
    const rig = makeRig();
    const f = await failure(autonomyPlan(rig.deps, { account: ACCOUNT, limits: [{ sym: "USDT", perTx: "1", perDay: "1" }], contacts: [], maxSlippageBps: 50, operatorDays: 1 }));
    expect([f.code, f.status]).toEqual(["not_ready", 503]);
    expect((await failure(autonomyStatus(rig.deps, ACCOUNT))).code).toBe("not_ready");
    expect((await failure(autonomyRevokePlan(rig.deps, { account: ACCOUNT }))).code).toBe("not_ready");
  });
});

describe("autonomy revoke and status", () => {
  it("revokes the operator and zeroes only the live allowances", async () => {
    const rig = guarded();
    rig.chain.allowances.set(`${TOKENS.USDT.address}:${ACCOUNT}:${GUARD}`.toLowerCase(), 5n);
    rig.chain.allowances.set(`${TOKENS.wBRL.address}:${ACCOUNT}:${GUARD}`.toLowerCase(), 7n);
    const res = await autonomyRevokePlan(rig.deps, { account: ACCOUNT });
    expect(decodeFunctionData({ abi: arbolitoGuardAbi, data: res.calls[0]!.data as Hex }).functionName).toBe("revokeOperator");
    expect(res.calls.slice(1).map((c) => c.to)).toEqual([TOKENS.wBRL.address, TOKENS.USDT.address]);
    for (const c of res.calls.slice(1)) expect(decodeFunctionData({ abi: erc20Abi, data: c.data as Hex }).args).toEqual([GUARD, 0n]);
    for (const c of res.calls) expect(attributionCodes(c.data as Hex)).toContain(CODE);
  });

  it("reads settings, operator, budgets and contacts from the guard", async () => {
    const rig = guarded();
    const expiry = BigInt(T0 / 1000 + 86_400);
    rig.chain.reads = {
      settings: () => [true, false, 100],
      operatorOf: () => [OPERATOR, expiry, true],
      limits: (a) => ((a[1] as string).toLowerCase() === TOKENS.USDT.address.toLowerCase() ? [20_000_000n, 50_000_000n] : [0n, 0n]),
      spentToday: (a) => ((a[1] as string).toLowerCase() === TOKENS.USDT.address.toLowerCase() ? 5_000_000n : 0n),
    };
    rig.chain.logs = [
      { args: { account: ACCOUNT, recipient: CONTACT, allowed: true } },
      { args: { account: ACCOUNT, recipient: OPERATOR, allowed: true } },
      { args: { account: ACCOUNT, recipient: OPERATOR, allowed: false } },
    ];
    const s = AutonomyStatus.parse(await autonomyStatus(rig.deps, ACCOUNT));
    expect(s).toMatchObject({
      configured: true,
      paused: false,
      operatorActive: true,
      operatorExpiry: new Date(Number(expiry) * 1000).toISOString(),
      maxSlippageBps: 100,
      limits: [{ sym: "USDT", perTx: "20000000", perDay: "50000000", spentToday: "5000000" }],
      contacts: [CONTACT],
    });
    // Another operator is not Arbolito's.
    rig.chain.reads.operatorOf = () => [CONTACT, expiry, true];
    expect((await autonomyStatus(rig.deps, ACCOUNT)).operatorActive).toBe(false);
  });
});
