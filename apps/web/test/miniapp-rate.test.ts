import { describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, toBytes, type Hex } from "viem";
import { TOKENS } from "@arbolito/config";
import { attributionCodes, REPUTATION_REGISTRY, reputationAbi } from "@arbolito/chain";
import { ApiFailure } from "../src/lib/miniapp/server/errors";
import { ratePrepare } from "../src/lib/miniapp/server/rate";
import { ACCOUNT, CODE, OTHER, makeRig, txHash } from "./miniapp-helpers";

const ID = "0b6c734e-0000-4000-8000-000000000001";

function rigWithReceipt() {
  const rig = makeRig();
  rig.store.receipts.push({
    id: ID,
    userId: null,
    bundleHash: "0xhash",
    bundle: {},
    tokenIn: TOKENS.USDT.address,
    tokenOut: TOKENS.wBRL.address,
    amountIn: "1000000",
    amountOut: "5450000000000000000",
    usdMicros: "1000000",
    taker: ACCOUNT,
    executionTx: txHash(1),
    executionBlock: 1n,
    anchorTx: txHash(2),
    anchorBlock: 2n,
    savingsBps: null,
    supersededBy: null,
    createdAt: new Date(),
  });
  return rig;
}

describe("rate prepare", () => {
  it("encodes a tagged giveFeedback for agent 9976 with the receipt as evidence", async () => {
    const rig = rigWithReceipt();
    const { calls } = await ratePrepare(rig.deps, { account: ACCOUNT, receiptId: ID, stars: 4 });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.to).toBe(REPUTATION_REGISTRY);
    expect(attributionCodes(c.data as Hex)).toContain(CODE);
    const { args } = decodeFunctionData({ abi: reputationAbi, data: c.data as Hex });
    const [agentId, value, decimals, tag1, tag2, , uri, hash] = args;
    expect([agentId, value, decimals, tag1, tag2]).toEqual([9976n, 80n, 0, "conversion", "USDT-wBRL"]);
    expect(uri).toMatch(new RegExp(`/r/${ID}$`));
    expect(hash).toBe(keccak256(toBytes(uri)));
  });

  it("refuses a wallet that didn't make the conversion", async () => {
    const rig = rigWithReceipt();
    const e = await ratePrepare(rig.deps, { account: OTHER, receiptId: ID, stars: 5 }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect((e as ApiFailure).status).toBe(403);
  });
});
