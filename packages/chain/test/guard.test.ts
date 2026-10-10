import { describe, expect, it } from "vitest";
import { decodeFunctionData, hashTypedData, type Address } from "viem";
import { CONTRACTS, TOKENS } from "@arbolito/config";
import {
  configTypedData,
  encodeApplyConfig,
  encodeGuardSwap,
  encodeV3Path,
  guardConstructorArgs,
  sessionExecutorAbi,
  type ConfigUpdate,
} from "../src";

const USDT = TOKENS.USDT.address;
const WARS = TOKENS.wARS.address;
const USAT = TOKENS.USAT.address;

describe("guard encoders", () => {
  it("packs Uniswap v3 paths (token | uint24 fee | token ...)", () => {
    const path = encodeV3Path([WARS, USDT, USAT], [100, 100]);
    expect(path).toBe(`0x${WARS.slice(2)}000064${USDT.slice(2)}000064${USAT.slice(2)}`.toLowerCase());
    expect((path.length - 2) / 2).toBe(20 + 23 * 2);
    expect(() => encodeV3Path([WARS], [])).toThrow();
    expect(() => encodeV3Path([WARS, USDT], [100, 100])).toThrow();
  });

  it("round-trips swapExactInput calldata", () => {
    const path = encodeV3Path([USDT, WARS], [100]);
    const { functionName, args } = decodeFunctionData({ abi: sessionExecutorAbi, data: encodeGuardSwap(path, 10_000_000n, 1n) });
    expect(functionName).toBe("swapExactInput");
    expect(args).toEqual([path, 10_000_000n, 1n]);
  });

  it("builds constructor args from the canonical config: 5 tokens, 3 routable 0.01% pools, 10 min TWAP", () => {
    const [router, factory, reactor, window, tokens, pools] = guardConstructorArgs();
    expect(router).toBe(CONTRACTS.uniswap.swapRouter02);
    expect(factory).toBe(CONTRACTS.uniswap.factory);
    expect(reactor).toBe(CONTRACTS.textile.limitOrderReactor);
    expect(window).toBe(600);
    expect(tokens).toHaveLength(5);
    expect(pools.map((p) => p.toLowerCase())).toEqual([
      "0x5d8ef8b839be522b9e3d60a51edb5837cd0b2391",
      "0x01c3cf91cdf7b34181c7ec8566c0236951fea40f",
      "0x070d575a713eaf5025462d0865fb0dac4b14bc38",
    ]);
  });

  it("binds the config signature to chain, guard, account and nonce", () => {
    const guard: Address = "0x00000000000000000000000000000000000000aa";
    const u: ConfigUpdate = {
      account: "0x00000000000000000000000000000000000000bb",
      nonce: 0n,
      deadline: 1n,
      paused: false,
      maxSlippageBps: 50,
      limits: [{ token: USDT, maxPerTx: 1n, maxPerDay: 2n }],
      recipients: [],
      prices: [],
    };
    const h = hashTypedData(configTypedData(42220, guard, u));
    expect(hashTypedData(configTypedData(11142220, guard, u))).not.toBe(h);
    expect(hashTypedData(configTypedData(42220, "0x00000000000000000000000000000000000000cc", u))).not.toBe(h);
    expect(hashTypedData(configTypedData(42220, guard, { ...u, nonce: 1n }))).not.toBe(h);
    expect(hashTypedData(configTypedData(42220, guard, { ...u, account: guard }))).not.toBe(h);
    const { args } = decodeFunctionData({ abi: sessionExecutorAbi, data: encodeApplyConfig(u, "0x1234") });
    expect(args[1]).toBe("0x1234");
  });
});
