/**
 * executeRoute against mocked viem clients and a fake TextileClient. No network: the fake
 * "chain" below answers sendGuarded's calls (clientVersion, estimateGas, sendTransaction,
 * receipts) and turns approve/swap calldata into receipts with ERC-20 Transfer logs.
 */
import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, TOKENS } from "@arbolito/config";
import { BroadcastError, MemoryLedger, USD, attributionCodes } from "@arbolito/chain";
import {
  erc20Abi,
  executableRoutes,
  executeRoute,
  executionSteps,
  parseExpiry,
  swapRouter02Abi,
  type ExecuteRouteParams,
  type Leg,
  type Quote,
  type Route,
  type TextileFirm,
  type TextileTaker,
} from "../src";

// anvil dev key #0: a throwaway, never funded on mainnet.
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const TAKER = account.address;
const { wBRL, USDT, wARS } = TOKENS;
const ROUTER = CONTRACTS.uniswap.swapRouter02;
const REACTOR = CONTRACTS.textile.limitOrderReactor;
const NOW = 1_760_000_000_000;
const CAPS = { maxActionMicros: USD(100), maxDailyMicros: USD(500) };
const e18 = 10n ** 18n;

// ---------- route fixtures ----------
function quote(venue: Quote["venue"], tokenIn: Address, tokenOut: Address, amountIn: bigint, amountOut: bigint): Quote {
  return { venue, tokenIn, tokenOut, amountIn, amountOut, blockNumber: 1n, firm: false, raw: {}, meta: venue === "uniswap_v3" ? { fee: 100 } : undefined };
}
const leg = (q: Quote, minOut = (q.amountOut * 995n) / 1000n): Leg => ({ quote: q, minOut });
function route(legs: Leg[]): Route {
  const last = legs[legs.length - 1]!;
  return {
    id: "route-1",
    label: "test",
    legs,
    tokenIn: legs[0]!.quote.tokenIn,
    tokenOut: last.quote.tokenOut,
    amountIn: legs[0]!.quote.amountIn,
    expectedOut: last.quote.amountOut,
    minOut: last.minOut,
    taker: TAKER,
  };
}
// 200 wBRL → 40 USDT → 64,000 wARS (planned)
const IN = 200n * e18;
const USDT_PLANNED = 40_000_000n;
const WARS_PLANNED = 64_000n * e18;
const uniBrlUsdt = () => leg(quote("uniswap_v3", wBRL.address, USDT.address, IN, USDT_PLANNED));
const uniUsdtArs = () => leg(quote("uniswap_v3", USDT.address, wARS.address, USDT_PLANNED, WARS_PLANNED));
const texBrlUsdt = () => leg(quote("textile_rfq", wBRL.address, USDT.address, IN, USDT_PLANNED));
const texUsdtArs = () => leg(quote("textile_rfq", USDT.address, wARS.address, USDT_PLANNED, WARS_PLANNED));

// ---------- fake chain ----------
const transferTopics = (from: Address, to: Address) =>
  encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }) as [Hex, ...Hex[]];
function transferLog(token: Address, from: Address, to: Address, value: bigint) {
  return { address: token, topics: transferTopics(from, to), data: encodeAbiParameters([{ type: "uint256" }], [value]), blockNumber: 100n, logIndex: 0, transactionIndex: 0, transactionHash: "0x" as Hex, blockHash: "0x" as Hex, removed: false };
}

interface SentTx {
  to: Address;
  data: Hex;
  hash: Hex;
}
interface ChainOpts {
  /** Actual Uniswap output by tokenOut (atomic). Reverts when below amountOutMinimum. */
  uniOut?: Partial<Record<Address, bigint>>;
  /** Reactor fills: what the swap delivers. */
  reactorFill?: { token: Address; amount: bigint };
  /** Return true to make a tx revert onchain. */
  revert?: (tx: SentTx) => boolean;
  /** Return true to make the receipt wait time out (tx unknown onchain). */
  hang?: (tx: SentTx) => boolean;
  clientVersion?: string;
  /** Blocks the RPC lags behind the chain head on each getBlockNumber call (a lagging node). */
  lag?: () => bigint;
}

function fakeChain(o: ChainOpts = {}) {
  const sent: SentTx[] = [];
  const receipts = new Map<Hex, { status: "success" | "reverted"; logs: unknown[]; blockNumber: bigint; transactionHash: Hex }>();
  const inputs = new Map<Hex, Hex>();
  const allowances = new Map<string, bigint>();
  /** Allowance history, so a read at an older block sees the older value (like a real node). */
  const history: { block: bigint; key: string; value: bigint }[] = [];
  const akey = (token: Address, spender: Address) => `${token.toLowerCase()}-${spender.toLowerCase()}`;
  const head = () => 100n + BigInt(sent.length);
  const setAllowance = (key: string, value: bigint, block = head()) => {
    allowances.set(key, value);
    history.push({ block, key, value });
  };
  const allowanceAt = (key: string, block: bigint) => {
    const hit = history.filter((h) => h.key === key && h.block <= block).at(-1);
    return hit ? hit.value : (allowances.has(key) && !history.some((h) => h.key === key) ? allowances.get(key)! : 0n);
  };

  const execute = (tx: SentTx) => {
    const logs: unknown[] = [];
    if (o.revert?.(tx)) return { status: "reverted" as const, logs };
    if (tx.to.toLowerCase() === ROUTER.toLowerCase()) {
      const { functionName, args } = decodeFunctionData({ abi: swapRouter02Abi, data: tx.data });
      const prm = args[0] as { tokenOut?: Address; path?: Hex; recipient: Address; amountOutMinimum: bigint };
      const tokenOut = functionName === "exactInputSingle" ? prm.tokenOut! : (`0x${prm.path!.slice(-40)}` as Address);
      const out = Object.entries(o.uniOut ?? {}).find(([t]) => t.toLowerCase() === tokenOut.toLowerCase())?.[1];
      if (out === undefined || out < prm.amountOutMinimum) return { status: "reverted" as const, logs };
      // Like a real ERC-20: the router's transferFrom spends the allowance (STF when short).
      const inPrm = args[0] as { tokenIn?: Address; path?: Hex; amountIn: bigint };
      const tokenIn = functionName === "exactInputSingle" ? inPrm.tokenIn! : (`0x${inPrm.path!.slice(2, 42)}` as Address);
      const k = akey(tokenIn, ROUTER);
      const have = allowances.get(k) ?? 0n;
      if (have < inPrm.amountIn) return { status: "reverted" as const, logs };
      setAllowance(k, have - inPrm.amountIn);
      logs.push(transferLog(tokenOut, ROUTER, prm.recipient, out));
    } else if (tx.to.toLowerCase() === REACTOR.toLowerCase()) {
      if (!o.reactorFill) return { status: "reverted" as const, logs };
      logs.push(transferLog(o.reactorFill.token, REACTOR, TAKER, o.reactorFill.amount));
    } else {
      // An ERC-20 approve.
      const { args } = decodeFunctionData({ abi: erc20Abi, data: tx.data });
      setAllowance(akey(tx.to, args[0] as Address), args[1] as bigint);
    }
    return { status: "success" as const, logs };
  };

  const publicClient = {
    getChainId: async () => 42220,
    request: async () => o.clientVersion ?? "anvil/v1.7.1",
    estimateGas: async () => 100_000n,
    getBlockNumber: async () => head() - (o.lag?.() ?? 0n),
    readContract: async ({ functionName, address, args, blockNumber }: { functionName: string; address: Address; args: [Address, Address]; blockNumber?: bigint }) => {
      if (functionName !== "allowance") throw new Error(`unexpected read ${functionName}`);
      return blockNumber === undefined ? (allowances.get(akey(address, args[1])) ?? 0n) : allowanceAt(akey(address, args[1]), blockNumber);
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const r = receipts.get(hash);
      // Like viem: a tx that never confirms surfaces as WaitForTransactionReceiptTimeoutError
      // (sendGuarded keeps polling through other, transient RPC errors).
      if (!r) throw Object.assign(new Error("Timed out while waiting for transaction"), { name: "WaitForTransactionReceiptTimeoutError" });
      return r;
    },
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const r = receipts.get(hash);
      if (!r) throw new Error("Transaction receipt not found");
      return r;
    },
    getTransaction: async ({ hash }: { hash: Hex }) => ({ input: inputs.get(hash)! }),
  } as unknown as PublicClient;

  const walletClient = {
    account,
    chain: undefined,
    sendTransaction: async (tx: { to: Address; data: Hex }) => {
      const hash = keccak256(toHex(`tx-${sent.length}`));
      const s = { to: tx.to, data: tx.data, hash };
      sent.push(s);
      inputs.set(hash, tx.data);
      if (!o.hang?.(s)) receipts.set(hash, { ...execute(s), blockNumber: 100n + BigInt(sent.length), transactionHash: hash });
      return hash;
    },
  } as unknown as WalletClient;

  return { publicClient, walletClient, sent, allowances, setAllowance, akey };
}

// ---------- fake Textile ----------
interface FakeTextileOpts {
  /** Build the firm response from the requested sell amount. */
  firm?: (sellAmount: bigint, buyToken: Address) => TextileFirm;
  submitFails?: boolean;
}
function fakeTextile(o: FakeTextileOpts = {}) {
  const calls = { request: [] as { sellAmount: bigint; sellToken: Address; buyToken: Address; taker: Address }[], submit: [] as Hex[], cancel: [] as string[], status: [] as string[] };
  const client: TextileTaker = {
    request: async (p) => {
      calls.request.push({ sellAmount: p.sellAmount, sellToken: p.sellToken, buyToken: p.buyToken, taker: p.taker });
      return o.firm!(p.sellAmount, p.buyToken);
    },
    submit: async (rfqId, _claim, txHash) => {
      calls.submit.push(txHash);
      if (o.submitFails) throw new Error("Textile API 409: expired");
      return { rfqId, status: "submitted" };
    },
    status: async (rfqId) => {
      calls.status.push(rfqId);
      return { rfqId, status: "filled" };
    },
    cancel: async (rfqId) => {
      calls.cancel.push(rfqId);
    },
  };
  return { client, calls };
}

function firmQuote(sellAmount: bigint, buyAmount: bigint, over: Partial<NonNullable<TextileFirm["quote"]>> = {}, expiresInMs = 50_000): TextileFirm {
  return {
    rfqId: "rfq-1",
    claimToken: "claim-secret",
    status: "quoted",
    quote: {
      sellAmount: sellAmount.toString(),
      buyAmount: buyAmount.toString(),
      feeAmount: "0",
      takerPays: sellAmount.toString(),
      rateRay: "1",
      expiresAt: new Date(NOW + expiresInMs).toISOString(),
      orderDeadline: new Date(NOW + 120_000).toISOString(),
      reactor: REACTOR,
      spender: REACTOR,
      taker: TAKER,
      orders: [],
      ...over,
    },
    transactions: { swap: { to: REACTOR, data: "0x0d335884", value: "0", chainId: 42220 } },
  };
}

function params(r: Route, chain: ReturnType<typeof fakeChain>, extra: Partial<ExecuteRouteParams> = {}): ExecuteRouteParams {
  return {
    route: r,
    taker: TAKER,
    account,
    publicClient: chain.publicClient,
    walletClient: chain.walletClient,
    mode: "fork",
    ledger: new MemoryLedger(),
    caps: CAPS,
    usdValue: USD(40),
    now: () => NOW,
    ...extra,
  };
}

// ---------- tests ----------
describe("executionSteps / parseExpiry", () => {
  it("groups consecutive Uniswap legs and isolates Textile legs", () => {
    expect(executionSteps(route([uniBrlUsdt(), uniUsdtArs()]))).toEqual([{ venue: "uniswap_v3", legIndexes: [0, 1] }]);
    expect(executionSteps(route([texBrlUsdt(), uniUsdtArs()]))).toEqual([
      { venue: "textile_rfq", legIndexes: [0] },
      { venue: "uniswap_v3", legIndexes: [1] },
    ]);
  });
  it("parses ISO, unix-second and unix-ms expiries", () => {
    expect(parseExpiry("2025-10-09T08:53:20.000Z")).toBe(1_760_000_000_000);
    expect(parseExpiry("1760000000")).toBe(1_760_000_000_000);
    expect(parseExpiry("1760000000000")).toBe(1_760_000_000_000);
  });
});

describe("executableRoutes", () => {
  const all = { best: route([texBrlUsdt(), uniUsdtArs()]), alternatives: [route([uniBrlUsdt(), uniUsdtArs()])] };
  it("returns only all-Uniswap routes without textileFirm", () => {
    expect(executableRoutes(all, { textileFirm: false })).toEqual([all.alternatives[0]]);
  });
  it("returns Textile RFQ routes with textileFirm, best first", () => {
    expect(executableRoutes(all, { textileFirm: true })).toEqual([all.best, all.alternatives[0]]);
  });
  it("never returns routes with venues executeRoute can't run", () => {
    const limit = route([leg(quote("textile_limit", wBRL.address, USDT.address, IN, USDT_PLANNED))]);
    expect(executableRoutes({ best: limit, alternatives: [] }, { textileFirm: true })).toEqual([]);
  });
});

describe("executeRoute", () => {
  it("runs an all-Uniswap route as one approve + one atomic swap, charging the caps once", async () => {
    const chain = fakeChain({ uniOut: { [wARS.address]: WARS_PLANNED } });
    const ledger = new MemoryLedger();
    const r = await executeRoute(params(route([uniBrlUsdt(), uniUsdtArs()]), chain, { ledger }));
    expect(r.status).toBe("complete");
    expect(r.finalAmountOut).toBe(WARS_PLANNED);
    expect(r.holding).toBeUndefined();
    expect(chain.sent.map((t) => t.to)).toEqual([wBRL.address, ROUTER]);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]).toMatchObject({ venue: "uniswap_v3", routeLegs: [0, 1], amountIn: IN, amountOut: WARS_PLANNED, txHash: chain.sent[1]!.hash });
    expect(r.legs[0]!.attribution).toEqual(attributionCodes(chain.sent[1]!.data));
    expect(r.legs[0]!.attribution.length).toBe(1);
    expect(await ledger.spent(new Date().toISOString().slice(0, 10))).toBe(USD(40));
  });

  it("skips the approve when the allowance already covers the swap", async () => {
    const chain = fakeChain({ uniOut: { [USDT.address]: USDT_PLANNED } });
    chain.setAllowance(chain.akey(wBRL.address, ROUTER), 10n ** 30n, 0n);
    const r = await executeRoute(params(route([uniBrlUsdt()]), chain));
    expect(r.status).toBe("complete");
    expect(chain.sent.map((t) => t.to)).toEqual([ROUTER]);
  });

  it("never trusts a lagging node's allowance: re-approves what the previous swap spent", async () => {
    // Mainnet 2026-10-15: a node behind the head reported the allowance swap #2 had already used,
    // the approve was skipped and swap #3 failed simulation (STF). With minBlock, the read waits
    // for a node at or past the last confirmed block, sees 0, and approves.
    let lagging = 3;
    const chain = fakeChain({ uniOut: { [USDT.address]: USDT_PLANNED }, lag: () => (lagging-- > 0 ? 2n : 0n) });
    const first = await executeRoute(params(route([uniBrlUsdt()]), chain));
    expect(first.status).toBe("complete");
    lagging = 3;
    const lastBlock = 100n + BigInt(chain.sent.length);
    const second = await executeRoute({ ...params(route([uniBrlUsdt()]), chain), minBlock: lastBlock });
    expect(second.status).toBe("complete");
    expect(chain.sent.map((t) => t.to)).toEqual([wBRL.address, ROUTER, wBRL.address, ROUTER]);
  });

  it("Uniswap → Textile: firm-quotes the actual leg-1 output, approves takerPays, sends the swap, submits the hash", async () => {
    const usdtActual = 39_900_000n; // a little under plan, still above leg 1's minOut
    const warsFirm = 63_900n * e18;
    const chain = fakeChain({ uniOut: { [USDT.address]: usdtActual }, reactorFill: { token: wARS.address, amount: warsFirm }, clientVersion: "Geth/v1" });
    const tex = fakeTextile({ firm: (sell) => firmQuote(sell, warsFirm) });
    const ledger = new MemoryLedger();
    const r = await executeRoute(
      params(route([uniBrlUsdt(), texUsdtArs()]), chain, { textile: tex.client, mode: "live", live: true, attributionCode: "arbolito_test", ledger }),
    );

    expect(r.status).toBe("complete");
    expect(r.finalAmountOut).toBe(warsFirm);
    expect(tex.calls.request).toEqual([{ sellAmount: usdtActual, sellToken: USDT.address, buyToken: wARS.address, taker: TAKER }]);
    // approve wBRL→router, swap, approve USDT→reactor (exactly takerPays), reactor swap
    expect(chain.sent.map((t) => t.to)).toEqual([wBRL.address, ROUTER, USDT.address, REACTOR]);
    const approve = decodeFunctionData({ abi: erc20Abi, data: chain.sent[2]!.data });
    expect(approve.args).toEqual([REACTOR, usdtActual]);
    expect(chain.sent[3]!.data.startsWith("0x0d335884")).toBe(true);
    expect(attributionCodes(chain.sent[3]!.data)).toEqual(["arbolito_test"]);
    expect(tex.calls.submit).toEqual([chain.sent[3]!.hash]);
    expect(tex.calls.cancel).toEqual([]);
    expect(r.legs.map((l) => [l.venue, l.amountIn, l.amountOut])).toEqual([
      ["uniswap_v3", IN, usdtActual],
      ["textile_rfq", usdtActual, warsFirm],
    ]);
    expect(r.legs[1]).toMatchObject({ rfqId: "rfq-1", rfq: { report: "submitted", statusAfter: "submitted" } });
    expect(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).not.toContain("claim-secret");
    // The route's USD value hits the caps once, not once per leg.
    expect(await ledger.spent(new Date().toISOString().slice(0, 10))).toBe(USD(40));
  });

  it("Textile → Uniswap: swaps exactly the firm buyAmount on Uniswap; on a fork it cancels instead of submitting", async () => {
    const usdtFirm = 40_100_000n; // firm beats the preview
    const warsActual = 64_150n * e18;
    const chain = fakeChain({ reactorFill: { token: USDT.address, amount: usdtFirm }, uniOut: { [wARS.address]: warsActual } });
    const tex = fakeTextile({ firm: (sell) => firmQuote(sell, usdtFirm) });
    const r = await executeRoute(params(route([texBrlUsdt(), uniUsdtArs()]), chain, { textile: tex.client }));

    expect(r.status).toBe("complete");
    expect(r.finalAmountOut).toBe(warsActual);
    expect(tex.calls.request[0]!.sellAmount).toBe(IN);
    expect(chain.sent.map((t) => t.to)).toEqual([wBRL.address, REACTOR, USDT.address, ROUTER]);
    const swap = decodeFunctionData({ abi: swapRouter02Abi, data: chain.sent[3]!.data });
    expect(swap.functionName).toBe("exactInputSingle");
    expect((swap.args[0] as { amountIn: bigint }).amountIn).toBe(usdtFirm);
    expect(tex.calls.submit).toEqual([]);
    expect(tex.calls.cancel).toEqual(["rfq-1"]);
    expect(r.legs[0]!.rfq!.report).toBe("skipped_fork");
  });

  it("cancels the RFQ and broadcasts nothing when the firm quote is below the leg minimum", async () => {
    const chain = fakeChain();
    const minOut = texBrlUsdt().minOut;
    const tex = fakeTextile({ firm: (sell) => firmQuote(sell, minOut - 1n) });
    const r = await executeRoute(params(route([texBrlUsdt(), uniUsdtArs()]), chain, { textile: tex.client }));
    expect(r.status).toBe("failed");
    expect(chain.sent).toEqual([]);
    expect(tex.calls.cancel).toEqual(["rfq-1"]);
    expect(r.error).toMatchObject({ leg: 0, venue: "textile_rfq", stage: "quote_rejected" });
    expect(r.error!.message).toMatch(/below the leg minimum/);
    expect(r.holding).toEqual({ token: wBRL.address, symbol: "wBRL", amount: IN, certain: true });
  });

  it("cancels the RFQ and broadcasts nothing when the quote is about to expire", async () => {
    const chain = fakeChain();
    const tex = fakeTextile({ firm: (sell) => firmQuote(sell, USDT_PLANNED, {}, 5_000) });
    const r = await executeRoute(params(route([texBrlUsdt()]), chain, { textile: tex.client }));
    expect(r.status).toBe("failed");
    expect(chain.sent).toEqual([]);
    expect(tex.calls.cancel).toEqual(["rfq-1"]);
    expect(r.error!.message).toMatch(/5s left, under the 15s margin/);
  });

  it("refuses a quote whose spender is not the Textile reactor", async () => {
    const chain = fakeChain();
    const evil = "0x000000000000000000000000000000000000dEaD";
    const tex = fakeTextile({ firm: (sell) => firmQuote(sell, USDT_PLANNED, { spender: evil }) });
    const r = await executeRoute(params(route([texBrlUsdt()]), chain, { textile: tex.client }));
    expect(r.status).toBe("failed");
    expect(chain.sent).toEqual([]);
    expect(tex.calls.cancel).toEqual(["rfq-1"]);
    expect(r.error!.message).toMatch(/LimitOrderReactor/);
  });

  it("leg 2 swap reverts after leg 1 settled: partial, holding the USDT leg 1 delivered", async () => {
    const usdtActual = 39_950_000n;
    const chain = fakeChain({ uniOut: { [USDT.address]: usdtActual }, revert: (tx) => tx.to.toLowerCase() === REACTOR.toLowerCase() });
    const tex = fakeTextile({ firm: (sell) => firmQuote(sell, WARS_PLANNED) });
    const r = await executeRoute(params(route([uniBrlUsdt(), texUsdtArs()]), chain, { textile: tex.client }));

    expect(r.status).toBe("partial");
    expect(r.finalAmountOut).toBe(0n);
    expect(r.legs).toHaveLength(1);
    expect(r.legs[0]).toMatchObject({ venue: "uniswap_v3", amountOut: usdtActual });
    expect(r.holding).toEqual({ token: USDT.address, symbol: "USDT", amount: usdtActual, certain: true });
    expect(r.txs.map((t) => [t.label.split(" ")[0], t.status])).toEqual([
      ["approve", "confirmed"],
      ["SwapRouter02.exactInputSingle", "confirmed"],
      ["approve", "confirmed"],
      ["Textile", "reverted"],
    ]);
    expect(r.error).toMatchObject({ leg: 1, venue: "textile_rfq", stage: "swap" });
    expect(tex.calls.cancel).toEqual(["rfq-1"]);
    expect(tex.calls.submit).toEqual([]);
  });

  it("leg 2 no_quote after leg 1 settled: partial, holding USDT, nothing more sent", async () => {
    const chain = fakeChain({ uniOut: { [USDT.address]: USDT_PLANNED } });
    const tex = fakeTextile({ firm: () => ({ rfqId: "rfq-2", claimToken: "c", status: "no_quote", reason: "no_makers_online" }) });
    const r = await executeRoute(params(route([uniBrlUsdt(), texUsdtArs()]), chain, { textile: tex.client }));
    expect(r.status).toBe("partial");
    expect(chain.sent).toHaveLength(2);
    expect(r.holding).toMatchObject({ token: USDT.address, amount: USDT_PLANNED, certain: true });
    expect(r.error!.message).toMatch(/no_quote \(no_makers_online\)/);
  });

  it("an unconfirmed Textile swap is reported as uncertain, never cancelled or re-sent", async () => {
    const chain = fakeChain({ uniOut: { [USDT.address]: USDT_PLANNED }, hang: (tx) => tx.to.toLowerCase() === REACTOR.toLowerCase() });
    const tex = fakeTextile({ firm: (sell) => firmQuote(sell, WARS_PLANNED) });
    const r = await executeRoute(params(route([uniBrlUsdt(), texUsdtArs()]), chain, { textile: tex.client }));
    expect(r.status).toBe("partial");
    expect(chain.sent.filter((t) => t.to.toLowerCase() === REACTOR.toLowerCase())).toHaveLength(1);
    expect(tex.calls.cancel).toEqual([]);
    expect(tex.calls.status).toEqual(["rfq-1"]);
    expect(r.holding).toMatchObject({
      token: USDT.address,
      amount: USDT_PLANNED,
      certain: false,
      alternative: { token: wARS.address, amount: WARS_PLANNED, txHash: chain.sent[3]!.hash },
    });
    expect(r.txs[3]!.status).toBe("unconfirmed");
    expect(r.error!.message).toMatch(/unconfirmed.*Textile status: filled/);
  });

  it("refuses to run when the taker isn't the sending wallet, before anything happens", async () => {
    const chain = fakeChain();
    const other = route([uniBrlUsdt()]);
    await expect(executeRoute(params(other, chain, { taker: "0x000000000000000000000000000000000000bEEF" }))).rejects.toThrow(/not the wallet/);
    expect(chain.sent).toEqual([]);
  });

  it("refuses a live run without live=true before any firm quote is taken", async () => {
    const chain = fakeChain({ clientVersion: "Geth/v1" });
    const tex = fakeTextile({ firm: (sell) => firmQuote(sell, USDT_PLANNED) });
    await expect(executeRoute(params(route([texBrlUsdt()]), chain, { textile: tex.client, mode: "live" }))).rejects.toThrow(/live=true/);
    expect(tex.calls.request).toEqual([]);
  });

  it("BroadcastError carries the hash for callers that need to check the chain", () => {
    const e = new BroadcastError("x", "0x01", "unconfirmed");
    expect(e.hash).toBe("0x01");
    expect(e.outcome).toBe("unconfirmed");
  });
});
