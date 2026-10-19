import { describe, expect, it } from "vitest";
import { decodeFunctionData, toFunctionSelector, type Address } from "viem";
import { CONTRACTS, TOKENS } from "@arbolito/config";
import {
  arbolitoGuardAbi,
  encodeGuardV2Configure,
  encodeGuardV2Pause,
  encodeGuardV2RevokeOperator,
  encodeGuardV2SendFor,
  encodeGuardV2SetOperator,
  encodeGuardV2SwapFor,
  encodeV3Path,
  guardV2ConstructorArgs,
  type GuardV2Config,
} from "../src";

const USDT = TOKENS.USDT.address;
const WARS = TOKENS.wARS.address;
const user: Address = "0x00000000000000000000000000000000000000bb";
const op: Address = "0x00000000000000000000000000000000000000cc";

describe("guard v2 encoders", () => {
  it("round-trips the operator calls", () => {
    const path = encodeV3Path([USDT, WARS], [100]);
    const swap = decodeFunctionData({ abi: arbolitoGuardAbi, data: encodeGuardV2SwapFor(user, path, 10_000_000n, 1n) });
    expect(swap.functionName).toBe("swapFor");
    expect(swap.args).toEqual([user, path, 10_000_000n, 1n]);
    const send = decodeFunctionData({ abi: arbolitoGuardAbi, data: encodeGuardV2SendFor(user, USDT, op, 5n) });
    expect(send.functionName).toBe("sendFor");
    expect(send.args).toEqual([user, USDT, op, 5n]);
    expect(decodeFunctionData({ abi: arbolitoGuardAbi, data: encodeGuardV2Pause(user) }).args).toEqual([user]);
  });

  it("round-trips the account calls and matches the Solidity selectors", () => {
    expect(encodeGuardV2SetOperator(op, 123n).slice(0, 10)).toBe(toFunctionSelector("setOperator(address,uint64)"));
    expect(encodeGuardV2RevokeOperator()).toBe(toFunctionSelector("revokeOperator()"));
    const cfg: GuardV2Config = {
      account: user,
      paused: false,
      maxSlippageBps: 50,
      limits: [{ token: USDT, maxPerTx: 1n, maxPerDay: 2n }],
      recipients: [{ recipient: op, allowed: true }],
      prices: [{ tokenIn: USDT, tokenOut: WARS, amountIn: 1n, amountOut: 2n, expiry: 3n }],
    };
    const data = encodeGuardV2Configure(cfg);
    expect(data.slice(0, 10)).toBe(
      toFunctionSelector(
        "configure((address,bool,uint16,(address,uint128,uint128)[],(address,bool)[],(address,address,uint128,uint128,uint64)[]))",
      ),
    );
    const { args } = decodeFunctionData({ abi: arbolitoGuardAbi, data });
    expect(args[0]).toEqual(cfg);
    expect(() => encodeGuardV2Configure({ ...cfg, maxSlippageBps: 1001 })).toThrow();
  });

  it("builds constructor args without a reactor: router, factory, 10 min TWAP, 5 tokens, 4 pools (USDC/USDT included)", () => {
    const [router, factory, window, tokens, pools] = guardV2ConstructorArgs();
    expect(router).toBe(CONTRACTS.uniswap.swapRouter02);
    expect(factory).toBe(CONTRACTS.uniswap.factory);
    expect(window).toBe(600);
    expect(tokens).toHaveLength(5);
    expect(pools).toHaveLength(4);
  });
});
