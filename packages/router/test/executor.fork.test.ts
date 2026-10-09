/**
 * Fork test: executeRoute on a mixed route (Uniswap wBRL→USDT, then Textile USDT→wARS) against
 * an anvil fork of Celo mainnet. The Uniswap leg is real (QuoterV2 + SwapRouter02 on fork state).
 * The Textile leg is mocked: a firm quote can't be fetched for a fork wallet (proof of funds is
 * checked on mainnet) and must not be (it locks real inventory), so a fake TextileClient returns
 * calldata for MockRfqReactor, which is etched at the real reactor address. Every send still
 * goes through sendGuarded (fork mode, anvil only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { createTestClient, createWalletClient, encodeFunctionData, http, parseAbi, parseEther, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, POOLS, TOKENS, findRepoRoot } from "@arbolito/config";
import { MemoryLedger, USD, attributionCodes, celoMainnet, makePublicClient, makeWalletClient } from "@arbolito/chain";
import {
  UniswapV3Adapter,
  applySlippage,
  erc20Abi,
  executeRoute,
  toAtomic,
  type Route,
  type TextileFirm,
  type TextileTaker,
} from "../src";

// anvil dev key #1 (the proof e2e uses #0): a throwaway that only exists on the fork.
const TAKER = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const { wBRL, USDT, wARS } = TOKENS;
const REACTOR = CONTRACTS.textile.limitOrderReactor;
const WBRL_POOL = POOLS.find((p) => p.name.startsWith("wBRL/USDT"))!.address;
const WARS_POOL = POOLS.find((p) => p.name.startsWith("wARS/USDT"))!.address;
const AMOUNT_IN = toAtomic(wBRL.address, "50");
const FORK_CAPS = { maxActionMicros: USD(100), maxDailyMicros: USD(500) };
const mockReactorAbi = parseAbi(["function fill(address sellToken, uint256 takerPays, address buyToken, uint256 buyAmount)"]);

const balanceOf = (client: PublicClient, token: Address, who: Address) =>
  client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [who] });

/** Fake Textile: firm-quotes `rate` wARS per USDT unit and returns MockRfqReactor calldata. */
function fakeTextile(o: { noQuote?: boolean; buyFor: (sell: bigint) => bigint }) {
  const calls = { request: [] as bigint[], submit: [] as Hex[], cancel: [] as string[] };
  const client: TextileTaker = {
    request: async (p): Promise<TextileFirm> => {
      calls.request.push(p.sellAmount);
      if (o.noQuote) return { rfqId: "rfq-fork", claimToken: "c", status: "no_quote", reason: "no_makers_online" };
      const buy = o.buyFor(p.sellAmount);
      return {
        rfqId: "rfq-fork",
        claimToken: "c",
        status: "quoted",
        quote: {
          sellAmount: p.sellAmount.toString(),
          buyAmount: buy.toString(),
          feeAmount: "0",
          takerPays: p.sellAmount.toString(),
          rateRay: "0",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          orderDeadline: new Date(Date.now() + 120_000).toISOString(),
          reactor: REACTOR,
          spender: REACTOR,
          taker: p.taker,
          orders: [],
        },
        transactions: {
          swap: {
            to: REACTOR,
            data: encodeFunctionData({ abi: mockReactorAbi, functionName: "fill", args: [p.sellToken, p.sellAmount, p.buyToken, buy] }),
            value: "0",
            chainId: 42220,
          },
        },
      };
    },
    submit: async (rfqId, _c, txHash) => {
      calls.submit.push(txHash);
      return { rfqId, status: "submitted" };
    },
    status: async (rfqId) => ({ rfqId, status: "open" }),
    cancel: async (rfqId) => {
      calls.cancel.push(rfqId);
    },
  };
  return { client, calls };
}

describe("fork: executeRoute on Uniswap → Textile(mock reactor)", () => {
  let publicClient: PublicClient;
  let walletClient: WalletClient;
  // Planned wARS per USDT, from a real QuoterV2 quote on the fork; the mock maker fills at it.
  let route: (amountIn: bigint) => Promise<Route>;
  const rateWarsPerUsdt = { num: 0n, den: 1n };

  beforeAll(async () => {
    const rpcUrl = inject("forkRpcUrl");
    publicClient = makePublicClient({ rpcUrl, pollingInterval: 100 });
    walletClient = makeWalletClient(TAKER, { rpcUrl, pollingInterval: 100 });
    const testClient = createTestClient({ mode: "anvil", chain: celoMainnet, transport: http(rpcUrl) });

    // Etch the mock reactor at Textile's reactor address and give it wARS to pay out.
    const artifact = JSON.parse(readFileSync(join(findRepoRoot(), "contracts", "out", "MockRfqReactor.sol", "MockRfqReactor.json"), "utf8")) as {
      deployedBytecode: { object: Hex };
    };
    await testClient.setCode({ address: REACTOR, bytecode: artifact.deployedBytecode.object });

    await testClient.setBalance({ address: TAKER.address, value: parseEther("10") });
    for (const [pool, token, to, amount] of [
      [WBRL_POOL, wBRL.address, TAKER.address, AMOUNT_IN * 2n],
      [WARS_POOL, wARS.address, REACTOR, toAtomic(wARS.address, "100000")],
    ] as const) {
      await testClient.setBalance({ address: pool, value: parseEther("1") });
      await testClient.impersonateAccount({ address: pool });
      const w = createWalletClient({ account: pool, chain: celoMainnet, transport: http(rpcUrl) });
      const hash = await w.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
      await publicClient.waitForTransactionReceipt({ hash });
      await testClient.stopImpersonatingAccount({ address: pool });
    }

    const uni = new UniswapV3Adapter(publicClient);
    const ref = await uni.quote({ tokenIn: USDT.address, tokenOut: wARS.address, amountIn: 1_000_000n, taker: TAKER.address, blockNumber: await publicClient.getBlockNumber() });
    rateWarsPerUsdt.num = ref!.amountOut; // wARS atomic per 1 USDT (1e6 atomic)
    rateWarsPerUsdt.den = 1_000_000n;

    route = async (amountIn: bigint) => {
      const blockNumber = await publicClient.getBlockNumber();
      const q1 = (await uni.quote({ tokenIn: wBRL.address, tokenOut: USDT.address, amountIn, taker: TAKER.address, blockNumber }))!;
      const q2Out = (q1.amountOut * rateWarsPerUsdt.num) / rateWarsPerUsdt.den;
      const legs = [
        { quote: q1, minOut: applySlippage(q1.amountOut, 50) },
        {
          quote: { venue: "textile_rfq" as const, tokenIn: USDT.address, tokenOut: wARS.address, amountIn: q1.amountOut, amountOut: q2Out, blockNumber, firm: false, raw: { kind: "preview" } },
          minOut: applySlippage(q2Out, 50),
        },
      ];
      return {
        id: `fork-${amountIn}`,
        label: "wBRL →[uniswap] USDT →[textile_rfq] wARS",
        legs,
        tokenIn: wBRL.address,
        tokenOut: wARS.address,
        amountIn,
        expectedOut: q2Out,
        minOut: legs[1]!.minOut,
        taker: TAKER.address,
      };
    };
  });

  it("executes both legs: real Uniswap swap, then the firm-quoted reactor fill for the actual USDT received", async () => {
    const r = await route(AMOUNT_IN);
    const tex = fakeTextile({ buyFor: (sell) => (sell * rateWarsPerUsdt.num) / rateWarsPerUsdt.den });
    const usdtBefore = await balanceOf(publicClient, USDT.address, TAKER.address);
    const warsBefore = await balanceOf(publicClient, wARS.address, TAKER.address);

    const result = await executeRoute({
      route: r,
      taker: TAKER.address,
      account: TAKER,
      publicClient,
      walletClient,
      mode: "fork",
      ledger: new MemoryLedger(),
      caps: FORK_CAPS,
      textile: tex.client,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("complete");
    const [uniLeg, texLeg] = result.legs;
    // The firm request asked for exactly what the Uniswap swap delivered (Transfer logs).
    expect(tex.calls.request).toEqual([uniLeg!.amountOut]);
    expect(uniLeg!.amountOut).toBeGreaterThanOrEqual(r.legs[0]!.minOut);
    expect(texLeg!.amountIn).toBe(uniLeg!.amountOut);
    // Onchain balances agree with the Transfer-log amounts: all USDT spent, wARS received.
    expect(await balanceOf(publicClient, USDT.address, TAKER.address)).toBe(usdtBefore);
    expect((await balanceOf(publicClient, wARS.address, TAKER.address)) - warsBefore).toBe(result.finalAmountOut);
    expect(result.finalAmountOut).toBeGreaterThanOrEqual(r.minOut);
    // approve wBRL, swap, approve USDT to reactor, reactor fill: all tagged, all confirmed.
    expect(result.txs.map((t) => t.status)).toEqual(["confirmed", "confirmed", "confirmed", "confirmed"]);
    for (const t of result.txs) expect(attributionCodes((await publicClient.getTransaction({ hash: t.hash })).input)).toHaveLength(1);
    // Fork: the RFQ is cancelled (releases inventory), never submitted with a fork hash.
    expect(tex.calls.submit).toEqual([]);
    expect(tex.calls.cancel).toEqual(["rfq-fork"]);
  });

  it("stops after the Uniswap leg on no_quote and reports the USDT the taker now holds", async () => {
    const r = await route(AMOUNT_IN);
    const tex = fakeTextile({ noQuote: true, buyFor: () => 0n });
    const usdtBefore = await balanceOf(publicClient, USDT.address, TAKER.address);

    const result = await executeRoute({
      route: r,
      taker: TAKER.address,
      account: TAKER,
      publicClient,
      walletClient,
      mode: "fork",
      ledger: new MemoryLedger(),
      caps: FORK_CAPS,
      textile: tex.client,
    });

    expect(result.status).toBe("partial");
    expect(result.holding!.token).toBe(USDT.address);
    expect(result.holding!.certain).toBe(true);
    expect((await balanceOf(publicClient, USDT.address, TAKER.address)) - usdtBefore).toBe(result.holding!.amount);
    expect(result.txs.every((t) => t.status === "confirmed")).toBe(true);
    expect(result.txs.some((t) => t.hash && t.label.startsWith("Textile"))).toBe(false);
  });
});
