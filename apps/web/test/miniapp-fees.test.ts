import { describe, expect, it } from "vitest";
import { TOKENS } from "@arbolito/config";
import { checkFeeReserve, networkFeeBalance } from "../src/lib/miniapp/server/fees";
import { hasNetworkFees } from "../src/lib/miniapp/client/derive";
import { ACCOUNT, makeRig } from "./miniapp-helpers";

describe("MiniPay fees for fiat sales", () => {
  it("blocks the founder's low-dollar case before any firm RFQ", async () => {
    const rig = makeRig();
    rig.chain.balances.set(`${TOKENS.USDT.address}:${ACCOUNT}`.toLowerCase(), 1664n);
    rig.chain.balances.set(`${TOKENS.wARS.address}:${ACCOUNT}`.toLowerCase(), 167_368_440000000000000000n);
    await expect(checkFeeReserve(rig.deps, ACCOUNT, "wARS", 6600n * 10n ** 18n)).rejects.toMatchObject({ code: "network_fee_required" });
    expect(rig.textile.requests).toHaveLength(0);
    rig.chain.balances.set(`${TOKENS.USDT.address}:${ACCOUNT}`.toLowerCase(), 101_664n);
    await expect(checkFeeReserve(rig.deps, ACCOUNT, "wARS", 6600n * 10n ** 18n)).resolves.toBeUndefined();
  });

  it("recognizes USDm with 18 decimals and requires one spendable fee token", async () => {
    const rig = makeRig();
    for (const sym of ["USDT", "USDC", "USAT"] as const) rig.chain.balances.set(`${TOKENS[sym].address}:${ACCOUNT}`.toLowerCase(), 20_000n);
    expect(await networkFeeBalance(rig.deps, ACCOUNT)).toBe(20_000n);
    rig.chain.balances.set(`${TOKENS.USDm.address}:${ACCOUNT}`.toLowerCase(), 50_000_000_000_000_000n);
    expect(await networkFeeBalance(rig.deps, ACCOUNT)).toBe(50_000n);
    expect(hasNetworkFees({ balances: [], networkFeeMicros: "50000" } as never)).toBe(true);
    expect(hasNetworkFees({ balances: [], networkFeeMicros: "1664" } as never)).toBe(false);
    expect(hasNetworkFees(null)).toBeNull();
  });
});
