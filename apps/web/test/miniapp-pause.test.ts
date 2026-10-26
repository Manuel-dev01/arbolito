import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { TOKENS } from "@arbolito/config";
import { pauseText } from "@arbolito/rules";
import { autonomyPause, autonomyStatus } from "../src/lib/miniapp/server/autonomy";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { ACCOUNT, OTHER, T0, makeRig, wallet } from "./miniapp-helpers";

const GUARD = "0x9999999999999999999999999999999999999999" as Address;
const OPERATOR = "0x8888888888888888888888888888888888888888" as Address;

async function failure(p: Promise<unknown>): Promise<ApiFailure> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiFailure) return e;
    throw e;
  }
  throw new Error("expected an ApiFailure");
}

const signed = async (paused: boolean, atMs: number) => {
  const at = new Date(atMs).toISOString();
  return { account: ACCOUNT, paused, at, signature: await wallet.signMessage({ message: pauseText(ACCOUNT, paused, at) }) };
};

describe("autonomy pause (signed, no transaction)", () => {
  it("pauses and resumes with the account's signature, and status reports it", async () => {
    const rig = makeRig({ guard: { address: GUARD, operator: OPERATOR } });
    rig.chain.reads = {
      settings: () => [true, false, 50],
      operatorOf: () => [OPERATOR, BigInt(T0 / 1000 + 86_400), true],
      limits: (a) => ((a[1] as string).toLowerCase() === TOKENS.USDT.address.toLowerCase() ? [1n, 2n] : [0n, 0n]),
      spentToday: () => 0n,
    };
    expect(await autonomyPause(rig.deps, await signed(true, T0))).toEqual({ paused: true });
    expect((await autonomyStatus(rig.deps, ACCOUNT)).paused).toBe(true);
    expect(await autonomyPause(rig.deps, await signed(false, T0 + 1_000))).toEqual({ paused: false });
    expect((await autonomyStatus(rig.deps, ACCOUNT)).paused).toBe(false);
  });

  it("refuses a replayed, stale or foreign signature", async () => {
    const rig = makeRig({ guard: { address: GUARD, operator: OPERATOR } });
    const pause = await signed(true, T0);
    await autonomyPause(rig.deps, pause);
    await autonomyPause(rig.deps, await signed(false, T0 + 1_000));
    // Replaying the older pause can't undo the newer resume.
    expect((await failure(autonomyPause(rig.deps, pause))).status).toBe(409);
    expect((await failure(autonomyPause(rig.deps, await signed(true, T0 - 11 * 60_000)))).message).toContain("too old");
    const foreign = { ...(await signed(true, T0 + 2_000)), account: OTHER };
    expect((await failure(autonomyPause(rig.deps, foreign))).message).toContain("doesn't match");
  });
});
