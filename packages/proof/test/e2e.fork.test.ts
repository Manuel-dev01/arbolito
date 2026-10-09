/**
 * Fork e2e: the full money path on an anvil fork of Celo mainnet.
 * fund → deploy ArbolitoReceipts → plan wBRL→wARS → execute via sendGuarded → build
 * ProofBundle → anchor → verify. No mainnet transaction is ever sent from here:
 * sendGuarded in fork mode refuses any RPC that isn't anvil.
 */
import { beforeAll, describe, expect, inject, it } from "vitest";
import {
  createTestClient,
  createWalletClient,
  encodeDeployData,
  http,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { POOLS, TOKENS } from "@arbolito/config";
import {
  CapExceededError,
  FORK_ATTRIBUTION_CODE,
  MemoryLedger,
  USD,
  attributionCodes,
  celoMainnet,
  makePublicClient,
  makeWalletClient,
  sendGuarded,
} from "@arbolito/chain";
import {
  TextileRfqAdapter,
  UniswapV3Adapter,
  buildRouteCalls,
  erc20Abi,
  executableRoutes,
  fetchReferences,
  plan,
  toAtomic,
  usdMicros,
  type PlanResult,
  type Route,
} from "@arbolito/router";
import { anchorBundle, buildBundle, bundleHash, receiptsAbi, receiptsBytecode, verifyBundle, type ProofBundle } from "../src";

// anvil's well-known dev key #0: a throwaway that only ever exists on the fork.
const TAKER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const WBRL_POOL = POOLS.find((p) => p.name.startsWith("wBRL/USDT"))!.address;
const AMOUNT_IN = toAtomic(TOKENS.wBRL.address, "200");
// The fork test moves ~$40, above the $5 build cap; it runs with an explicit fork-only cap.
const FORK_CAPS = { maxActionMicros: USD(100), maxDailyMicros: USD(500) };

describe("fork e2e: wBRL → wARS with an anchored, verified receipt", () => {
  let publicClient: PublicClient;
  let walletClient: WalletClient;
  let receipts: Address;
  let planned: PlanResult;
  let route: Route;
  let swapTx: Hex;
  let received: bigint;
  let bundle: ProofBundle;
  const ledger = new MemoryLedger();

  beforeAll(async () => {
    const rpcUrl = inject("forkRpcUrl");
    publicClient = makePublicClient({ rpcUrl, pollingInterval: 100 });
    walletClient = makeWalletClient(TAKER, { rpcUrl, pollingInterval: 100 });
    const testClient = createTestClient({ mode: "anvil", chain: celoMainnet, transport: http(rpcUrl) });

    // Gas money for the taker; borrow 200 wBRL from the pool's balance via impersonation.
    await testClient.setBalance({ address: TAKER.address, value: parseEther("10") });
    await testClient.setBalance({ address: WBRL_POOL, value: parseEther("1") });
    await testClient.impersonateAccount({ address: WBRL_POOL });
    const pool = createWalletClient({ account: WBRL_POOL, chain: celoMainnet, transport: http(rpcUrl) });
    const fundTx = await pool.writeContract({
      address: TOKENS.wBRL.address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [TAKER.address, AMOUNT_IN],
    });
    await publicClient.waitForTransactionReceipt({ hash: fundTx });
    await testClient.stopImpersonatingAccount({ address: WBRL_POOL });
  });

  it("funds the taker with 200 wBRL", async () => {
    const bal = await publicClient.readContract({ address: TOKENS.wBRL.address, abi: erc20Abi, functionName: "balanceOf", args: [TAKER.address] });
    expect(bal).toBe(AMOUNT_IN);
  });

  it("deploys ArbolitoReceipts through the guarded sender, with attribution on the initcode", async () => {
    const { receipt, data } = await sendGuarded({
      mode: "fork",
      publicClient,
      walletClient,
      data: encodeDeployData({ abi: receiptsAbi, bytecode: receiptsBytecode(), args: [TAKER.address] }),
      usdMicros: 0n,
      purpose: "deploy ArbolitoReceipts (fork)",
      ledger,
    });
    expect(receipt.contractAddress).toBeTruthy();
    receipts = receipt.contractAddress!;
    expect(attributionCodes(data)).toContain(FORK_ATTRIBUTION_CODE);
    expect(await publicClient.readContract({ address: receipts, abi: receiptsAbi, functionName: "owner" })).toBe(TAKER.address);
  });

  it("plans the best route with alternatives considered", async () => {
    planned = await plan({
      client: publicClient,
      adapters: [new UniswapV3Adapter(publicClient), new TextileRfqAdapter()],
      tokenIn: TOKENS.wBRL.address,
      tokenOut: TOKENS.wARS.address,
      amountIn: AMOUNT_IN,
      taker: TAKER.address,
    });
    expect(planned.best).not.toBeNull();
    expect(planned.quotesConsidered.length).toBeGreaterThanOrEqual(2);
    // Textile previews compete in planning; firm Textile execution is opt-in, so execute the
    // best route that is executable without it (all-Uniswap here).
    route = executableRoutes(planned, { textileFirm: false })[0]!;
    expect(route.label).toBe("wBRL →[uniswap 0.01%] USDT →[uniswap 0.01%] wARS");
    expect(route.expectedOut).toBeGreaterThan(0n);
  });

  it("refuses the swap under the default $5 build cap", async () => {
    const [, swap] = buildRouteCalls(route, TAKER.address);
    const value = await usdMicros(publicClient, TOKENS.wBRL.address, AMOUNT_IN);
    expect(value).toBeGreaterThan(USD(5));
    await expect(
      sendGuarded({ mode: "fork", publicClient, walletClient, to: swap!.to, data: swap!.data, usdMicros: value, purpose: "swap", ledger: new MemoryLedger() }),
    ).rejects.toThrow(CapExceededError);
  });

  it("executes the route and receives at least minOut", async () => {
    const calls = buildRouteCalls(route, TAKER.address);
    const value = await usdMicros(publicClient, TOKENS.wBRL.address, AMOUNT_IN);
    const before = await publicClient.readContract({ address: TOKENS.wARS.address, abi: erc20Abi, functionName: "balanceOf", args: [TAKER.address] });
    for (const [i, call] of calls.entries()) {
      const isSwap = i === calls.length - 1; // approve first, swap last
      const { hash } = await sendGuarded({
        mode: "fork",
        publicClient,
        walletClient,
        to: call.to,
        data: call.data,
        usdMicros: isSwap ? value : 0n,
        purpose: call.label,
        caps: FORK_CAPS,
        ledger,
      });
      if (isSwap) swapTx = hash;
    }
    const after = await publicClient.readContract({ address: TOKENS.wARS.address, abi: erc20Abi, functionName: "balanceOf", args: [TAKER.address] });
    received = after - before;
    expect(received).toBeGreaterThanOrEqual(route.minOut);
    // Nothing else trades on the fork, so the executed amount equals the quote.
    expect(received).toBe(route.expectedOut);

    const tx = await publicClient.getTransaction({ hash: swapTx });
    expect(attributionCodes(tx.input)).toEqual([FORK_ATTRIBUTION_CODE]);
  });

  it("builds a ProofBundle, anchors it and verifies it end to end", async () => {
    const swapReceipt = await publicClient.getTransactionReceipt({ hash: swapTx });
    const tx = await publicClient.getTransaction({ hash: swapTx });
    const refs = await fetchReferences(publicClient, planned.blockNumber);
    bundle = buildBundle({
      route: route,
      alternatives: planned.alternatives,
      quotesConsidered: planned.quotesConsidered,
      references: refs.references,
      execution: { txHash: swapTx, blockNumber: swapReceipt.blockNumber, amountOut: received, attribution: attributionCodes(tx.input) },
    });

    const anchored = await anchorBundle({ bundle, receipts, mode: "fork", publicClient, walletClient });
    expect(anchored.bundleHash).toBe(bundleHash(bundle));

    // Verify from the published JSON, as a third party would.
    const published = JSON.parse(JSON.stringify(bundle));
    const result = await verifyBundle(published, { client: publicClient, receipts, emitters: [TAKER.address] });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.anchor!.txHash).toBe(anchored.txHash);
  });

  it("rejects a tampered bundle", async () => {
    const tampered = { ...JSON.parse(JSON.stringify(bundle)), execution: { ...bundle.execution, amountOut: "1" } };
    const result = await verifyBundle(tampered, { client: publicClient, receipts });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/not anchored/);
  });

  it("rejects a bundle anchored by an unknown emitter", async () => {
    const result = await verifyBundle(JSON.parse(JSON.stringify(bundle)), {
      client: publicClient,
      receipts,
      emitters: ["0x000000000000000000000000000000000000dEaD"],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/not an allowed Arbolito emitter/);
  });
});
