import { encodeFunctionData, type Address, type Hex, type LocalAccount, type PublicClient, type WalletClient } from "viem";
import { CONTRACTS, tokenByAddress } from "@arbolito/config";
import {
  BroadcastError,
  LiveGuardError,
  attributionCodes,
  sendGuarded,
  type Caps,
  type GuardedSendResult,
  type SpendLedger,
} from "@arbolito/chain";
import { erc20Abi } from "./abis";
import { receivedInTx } from "./execution";
import { usdMicros } from "./pricing";
import type { TextileClient, TextileFirm } from "./textile/api";
import type { Leg, Route } from "./types";
import { buildUniswapCalls } from "./uniswap/adapter";

/**
 * Sequential route executor. Consecutive Uniswap legs run as one atomic exactInput; each
 * Textile leg takes a firm RFQ for the amount the previous step actually delivered, checks it,
 * then broadcasts the venue's settlement tx. Every send goes through sendGuarded.
 *
 * Failure semantics: execution stops at the first failed step and the result states exactly
 * what the taker holds and which txs happened. Nothing is ever retried blindly: an
 * unconfirmed tx is looked up onchain once and, if still unknown, reported as uncertain.
 */

/** The TextileClient surface the executor uses (lets tests inject a fake). */
export type TextileTaker = Pick<TextileClient, "request" | "submit" | "status" | "cancel">;

export type ExecutionStage =
  | "firm_quote"
  | "quote_rejected"
  | "rfq_cancelled"
  | "approve"
  | "swap"
  | "confirmed"
  | "reported"
  | "failed";

export interface ExecutionProgress {
  /** Index of the step's first route leg. */
  leg: number;
  venue: "uniswap_v3" | "textile_rfq";
  stage: ExecutionStage;
  message: string;
  txHash?: Hex;
}

export interface ExecuteRouteParams {
  route: Route;
  /** Must be the wallet that signs and sends (walletClient.account) and the account below. */
  taker: Address;
  /** Signs Textile TakerControl proofs for keyless firm requests. */
  account: LocalAccount;
  publicClient: PublicClient;
  walletClient: WalletClient;
  mode: "fork" | "live";
  live?: boolean;
  ledger?: SpendLedger;
  caps?: Caps;
  /** Required when the route has Textile legs. */
  textile?: TextileTaker;
  /**
   * USD value of the whole route (micro-USD), charged to the caps once, on the first
   * value-moving send. Defaults to pricing route.amountIn of route.tokenIn.
   */
  usdValue?: bigint;
  /** Gas token symbol (mainnet only). */
  feeCurrency?: string;
  /** ERC-8021 code override (sendGuarded defaults to ATTRIBUTION_CODE). */
  attributionCode?: string;
  /**
   * Allowance reads are trusted only at or after this block (e.g. the last receipt of a previous
   * route). A lagging RPC node once reported an allowance the previous swap had already spent,
   * so the approve was skipped and the swap failed simulation (STF).
   */
  minBlock?: bigint;
  /** A firm quote must have at least this long left before its swap is broadcast. Default 15s. */
  expiryMarginMs?: number;
  onProgress?: (p: ExecutionProgress) => void;
  /** Clock (ms), for tests. */
  now?: () => number;
}

export interface RfqReport {
  rfqId: string;
  buyAmount: bigint;
  expiresAt: string;
  /** What happened when the fill was reported: submitted live, skipped on a fork (RFQ cancelled), or failed. */
  report: "submitted" | "skipped_fork" | "submit_failed";
  /** Textile status after submit (or after a failed submit, from GET /rfq/{id}). */
  statusAfter?: string;
  error?: string;
}

/** One executed step: a single tx covering one Textile leg or a run of Uniswap legs. */
export interface ExecutedLeg {
  venue: "uniswap_v3" | "textile_rfq";
  /** Route leg indexes this step covered. */
  routeLegs: number[];
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  /** From the swap tx's Transfer logs to the taker. */
  amountOut: bigint;
  txHash: Hex;
  blockNumber: bigint;
  /** ERC-8021 codes in the swap calldata as sent. */
  attribution: string[];
  approvalTxHash?: Hex;
  rfqId?: string;
  rfq?: RfqReport;
}

export interface ExecutionTx {
  hash: Hex;
  label: string;
  leg: number;
  status: "confirmed" | "reverted" | "unconfirmed";
}

export interface Holding {
  token: Address;
  symbol: string;
  /** Atomic units the route left with the taker (the route's own funds only). */
  amount: bigint;
  /** False when a swap's outcome is unknown; see `alternative`. */
  certain: boolean;
  /** If the uncertain tx landed, the taker holds this instead. */
  alternative?: { token: Address; symbol: string; amount: bigint; txHash: Hex };
}

export interface ExecuteRouteResult {
  routeId: string;
  status: "complete" | "partial" | "failed";
  legs: ExecutedLeg[];
  /** Final-token amount delivered (0n unless complete). */
  finalAmountOut: bigint;
  /** What the route's funds are now, when it did not complete. */
  holding?: Holding;
  /** Every tx sent, in order, including approvals and failures. */
  txs: ExecutionTx[];
  error?: { leg: number; venue: "uniswap_v3" | "textile_rfq"; stage: string; message: string };
  warnings: string[];
}

const DEFAULT_EXPIRY_MARGIN_MS = 15_000;
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sym = (a: Address) => tokenByAddress(a).symbol;
const errMsg = (err: unknown) => (err as { shortMessage?: string }).shortMessage ?? (err as Error).message ?? String(err);

/** Group legs into steps: each Textile leg alone, consecutive Uniswap legs together. */
export function executionSteps(route: Route): { venue: "uniswap_v3" | "textile_rfq"; legIndexes: number[] }[] {
  const steps: { venue: "uniswap_v3" | "textile_rfq"; legIndexes: number[] }[] = [];
  route.legs.forEach((leg, i) => {
    const venue = leg.quote.venue;
    if (venue !== "uniswap_v3" && venue !== "textile_rfq") throw new Error(`Leg ${i} venue ${venue} is not executable`);
    const last = steps[steps.length - 1];
    if (venue === "uniswap_v3" && last?.venue === "uniswap_v3") last.legIndexes.push(i);
    else steps.push({ venue, legIndexes: [i] });
  });
  return steps;
}

/** Textile timestamps: ISO 8601, or a numeric string in seconds or milliseconds. */
export function parseExpiry(s: string): number {
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`Unparseable expiresAt: ${s}`);
  return ms;
}

function validateRoute(route: Route) {
  if (route.legs.length === 0) throw new Error("Route has no legs");
  if (!eq(route.legs[0]!.quote.tokenIn, route.tokenIn)) throw new Error("First leg does not start at route.tokenIn");
  if (!eq(route.legs[route.legs.length - 1]!.quote.tokenOut, route.tokenOut)) throw new Error("Last leg does not end at route.tokenOut");
  for (let i = 1; i < route.legs.length; i++) {
    if (!eq(route.legs[i - 1]!.quote.tokenOut, route.legs[i]!.quote.tokenIn)) throw new Error(`Leg ${i} does not chain from leg ${i - 1}`);
  }
}

/** Internal: a step stopped. `uncertainTx` is set when a swap was broadcast with an unknown outcome. */
class StepFailure extends Error {
  constructor(
    readonly stage: string,
    message: string,
    readonly uncertainTx?: { hash: Hex; expectedOut: bigint },
  ) {
    super(message);
  }
}

export async function executeRoute(p: ExecuteRouteParams): Promise<ExecuteRouteResult> {
  const { route, taker } = p;
  // Preflight: programmer errors throw here, before anything is quoted or sent.
  validateRoute(route);
  const steps = executionSteps(route);
  const sender = p.walletClient.account?.address;
  if (!sender || !eq(sender, taker)) throw new Error(`taker ${taker} is not the wallet that sends (${sender ?? "none"})`);
  if (!eq(p.account.address, taker)) throw new Error(`account ${p.account.address} is not the taker ${taker}`);
  if (!eq(route.taker, taker)) throw new Error(`route was planned for ${route.taker}, not ${taker}`);
  if (steps.some((s) => s.venue === "textile_rfq") && !p.textile) throw new Error("Route has Textile legs but no Textile client was given");
  // sendGuarded enforces this too, but a Textile-first route would otherwise lock a firm quote first.
  if (p.mode === "live" && p.live !== true) throw new LiveGuardError("Mainnet execution requires live=true (--live)");

  const now = p.now ?? Date.now;
  const marginMs = p.expiryMarginMs ?? DEFAULT_EXPIRY_MARGIN_MS;
  const usdValue = p.usdValue ?? (await usdMicros(p.publicClient, route.tokenIn, route.amountIn));
  const chainId = await p.publicClient.getChainId();

  const legs: ExecutedLeg[] = [];
  const txs: ExecutionTx[] = [];
  /** Newest block this flow has seen confirmed; allowance reads must be at least this fresh. */
  let freshBlock = p.minBlock ?? 0n;
  const warnings: string[] = [];
  let valueCharged = false; // caps see the route's USD value once, on the first value-moving send
  let amountIn = route.amountIn;

  const progress = (e: ExecutionProgress) => p.onProgress?.(e);

  /** One guarded send. Records the tx; maps BroadcastError to a StepFailure with what we know. */
  const send = async (
    leg: number,
    call: { to: Address; data: Hex; value?: bigint; label: string },
    valueMoving: boolean,
    expectedOut?: { token: Address; amount: bigint },
  ): Promise<GuardedSendResult> => {
    const usd = valueMoving && !valueCharged ? usdValue : 0n;
    try {
      const sent = await sendGuarded({
        mode: p.mode,
        live: p.live,
        publicClient: p.publicClient,
        walletClient: p.walletClient,
        to: call.to,
        data: call.data,
        value: call.value,
        usdMicros: usd,
        purpose: call.label,
        feeCurrency: p.feeCurrency,
        attributionCode: p.attributionCode,
        caps: p.caps,
        ledger: p.ledger,
      });
      if (valueMoving) valueCharged = true;
      if (sent.receipt.blockNumber > freshBlock) freshBlock = sent.receipt.blockNumber;
      txs.push({ hash: sent.hash, label: call.label, leg, status: "confirmed" });
      return sent;
    } catch (err) {
      if (!(err instanceof BroadcastError)) throw new StepFailure(valueMoving ? "swap" : "approve", `${call.label}: not sent (${errMsg(err)})`);
      if (valueMoving) valueCharged = true; // its reservation stays in the ledger
      if (err.outcome === "reverted") {
        txs.push({ hash: err.hash, label: call.label, leg, status: "reverted" });
        throw new StepFailure(valueMoving ? "swap" : "approve", `${call.label}: reverted (${err.hash})`);
      }
      // Unconfirmed: look it up once. Never re-send.
      const receipt = await p.publicClient.getTransactionReceipt({ hash: err.hash }).catch(() => null);
      if (receipt?.status === "success") {
        txs.push({ hash: err.hash, label: call.label, leg, status: "confirmed" });
        warnings.push(`${call.label}: receipt wait timed out, but ${err.hash} is confirmed onchain`);
        return { hash: err.hash, receipt, data: (await p.publicClient.getTransaction({ hash: err.hash })).input };
      }
      if (receipt?.status === "reverted") {
        txs.push({ hash: err.hash, label: call.label, leg, status: "reverted" });
        throw new StepFailure(valueMoving ? "swap" : "approve", `${call.label}: reverted (${err.hash})`);
      }
      txs.push({ hash: err.hash, label: call.label, leg, status: "unconfirmed" });
      const uncertain = valueMoving && expectedOut ? { hash: err.hash, expectedOut: expectedOut.amount } : undefined;
      throw new StepFailure(valueMoving ? "swap" : "approve", `${call.label}: ${err.hash} unconfirmed; check it onchain before doing anything else`, uncertain);
    }
  };

  /**
   * The allowance as of a block at or after everything this flow has confirmed. If no fresh read
   * can be had, report 0 so the caller approves again: an exact approval is harmless; a skipped
   * one fails the swap.
   */
  const allowance = async (token: Address, spender: Address): Promise<bigint> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const head = await p.publicClient.getBlockNumber({ cacheTime: 0 });
        if (head >= freshBlock) return await p.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [taker, spender], blockNumber: head });
      } catch {
        // a node without that block yet; try again
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
    return 0n;
  };

  const runUniswap = async (legIndexes: number[]): Promise<ExecutedLeg> => {
    const first = legIndexes[0]!;
    const planned = legIndexes.map((i) => route.legs[i]!);
    // Swap exactly what the previous step delivered; keep the planned per-leg minimums.
    const segment: Leg[] = planned.map((l, j) => (j === 0 ? { ...l, quote: { ...l.quote, amountIn } } : l));
    const last = segment[segment.length - 1]!;
    const tokenIn = segment[0]!.quote.tokenIn;
    const tokenOut = last.quote.tokenOut;
    const [approveCall, swapCall] = buildUniswapCalls(segment, taker, last.minOut) as [
      { to: Address; data: Hex; value: bigint; label: string },
      { to: Address; data: Hex; value: bigint; label: string },
    ];
    let approvalTxHash: Hex | undefined;
    if ((await allowance(tokenIn, swapCall.to)) < amountIn) {
      progress({ leg: first, venue: "uniswap_v3", stage: "approve", message: approveCall.label });
      approvalTxHash = (await send(first, approveCall, false)).hash;
    }
    progress({ leg: first, venue: "uniswap_v3", stage: "swap", message: swapCall.label });
    const swap = await send(first, swapCall, true, { token: tokenOut, amount: last.quote.amountOut });
    const out = receivedInTx(swap.receipt, tokenOut, taker);
    progress({ leg: first, venue: "uniswap_v3", stage: "confirmed", message: `received ${out} ${sym(tokenOut)} (atomic)`, txHash: swap.hash });
    return {
      venue: "uniswap_v3",
      routeLegs: legIndexes,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: out,
      txHash: swap.hash,
      blockNumber: swap.receipt.blockNumber,
      attribution: attributionCodes(swap.data),
      approvalTxHash,
    };
  };

  const runTextile = async (i: number): Promise<ExecutedLeg> => {
    const leg = route.legs[i]!;
    const textile = p.textile!;
    const tokenIn = leg.quote.tokenIn;
    const tokenOut = leg.quote.tokenOut;

    progress({ leg: i, venue: "textile_rfq", stage: "firm_quote", message: `firm RFQ for ${amountIn} ${sym(tokenIn)} (atomic)` });
    let firm: TextileFirm;
    try {
      // Never retried: a lost response may still have reserved inventory, which expires on its own.
      firm = await textile.request({ chainId, sellToken: tokenIn, buyToken: tokenOut, sellAmount: amountIn, taker, account: p.account });
    } catch (err) {
      throw new StepFailure("firm_quote", `Textile firm request failed: ${errMsg(err)}`);
    }

    const cancel = async (why: string, stage = "quote_rejected"): Promise<never> => {
      let note = "RFQ cancelled";
      try {
        await textile.cancel(firm.rfqId, firm.claimToken);
        progress({ leg: i, venue: "textile_rfq", stage: "rfq_cancelled", message: `${why}; RFQ ${firm.rfqId} cancelled` });
      } catch (err) {
        note = `RFQ cancel failed (${errMsg(err)}); it expires on its own`;
        warnings.push(`leg ${i}: ${note}`);
      }
      throw new StepFailure(stage, `${why} (${note})`);
    };

    if (firm.status !== "quoted" || !firm.quote || !firm.transactions) {
      throw new StepFailure("firm_quote", `Textile returned ${firm.status}${firm.reason ? ` (${firm.reason})` : ""}`);
    }
    const q = firm.quote;
    const swapTx = firm.transactions.swap;
    const reactor = CONTRACTS.textile.limitOrderReactor;
    const buyAmount = BigInt(q.buyAmount);
    const takerPays = BigInt(q.takerPays);
    progress({ leg: i, venue: "textile_rfq", stage: "firm_quote", message: `quoted ${buyAmount} ${sym(tokenOut)} (atomic), expires ${q.expiresAt}` });

    // Checks before anything is broadcast. Any failure cancels the RFQ (releases inventory).
    if (!eq(q.taker, taker)) await cancel(`quote is bound to ${q.taker}, not the taker`);
    if (BigInt(q.sellAmount) !== amountIn) await cancel(`quote sells ${q.sellAmount}, requested ${amountIn}`);
    if (takerPays > amountIn) await cancel(`takerPays ${takerPays} exceeds the leg input ${amountIn}`);
    if (!eq(q.spender, reactor) || !eq(swapTx.to, reactor)) await cancel(`unexpected spender/target ${q.spender}/${swapTx.to} (expected the LimitOrderReactor)`);
    if (swapTx.chainId !== chainId || BigInt(swapTx.value) !== 0n) await cancel(`swap tx has chainId ${swapTx.chainId} and value ${swapTx.value}`);
    if (buyAmount < leg.minOut) await cancel(`firm quote ${buyAmount} is below the leg minimum ${leg.minOut}`);
    const expiresAt = parseExpiry(q.expiresAt);
    const checkExpiry = async () => {
      const left = expiresAt - now();
      if (left < marginMs) await cancel(`firm quote has ${Math.max(0, Math.round(left / 1000))}s left, under the ${marginMs / 1000}s margin`);
    };
    await checkExpiry();

    let approvalTxHash: Hex | undefined;
    try {
      if ((await allowance(tokenIn, q.spender as Address)) < takerPays) {
        const label = `approve ${sym(tokenIn)} to Textile reactor`;
        progress({ leg: i, venue: "textile_rfq", stage: "approve", message: label });
        // Our own exact approve (takerPays to the verified reactor), not the API's approval calldata.
        const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [q.spender as Address, takerPays] });
        approvalTxHash = (await send(i, { to: tokenIn, data, label }, false)).hash;
      }
    } catch (err) {
      // The approval moved nothing; release the inventory.
      await cancel(err instanceof StepFailure ? err.message : `approval failed: ${errMsg(err)}`, "approve");
    }
    await checkExpiry(); // the approve took time

    const label = `Textile reactor executeBatch (RFQ ${firm.rfqId})`;
    progress({ leg: i, venue: "textile_rfq", stage: "swap", message: label });
    let swap: GuardedSendResult;
    try {
      swap = await send(i, { to: swapTx.to as Address, data: swapTx.data as Hex, value: 0n, label }, true, { token: tokenOut, amount: buyAmount });
    } catch (err) {
      if (err instanceof StepFailure && err.uncertainTx) {
        // Don't cancel: the signed orders can still land until orderDeadline. Report Textile's view.
        const st = await textile.status(firm.rfqId, firm.claimToken).catch((e: unknown) => ({ status: `unknown (${errMsg(e)})` }));
        throw new StepFailure(err.stage, `${err.message}; Textile status: ${st.status}`, err.uncertainTx);
      }
      return cancel(err instanceof StepFailure ? err.message : errMsg(err), "swap");
    }
    const out = receivedInTx(swap.receipt, tokenOut, taker);
    if (out !== buyAmount) warnings.push(`leg ${i}: received ${out}, firm quote said ${buyAmount}`);
    progress({ leg: i, venue: "textile_rfq", stage: "confirmed", message: `received ${out} ${sym(tokenOut)} (atomic)`, txHash: swap.hash });

    // Report the fill. Never retried: on error, read the status and record both.
    const rfq: RfqReport = { rfqId: firm.rfqId, buyAmount, expiresAt: q.expiresAt, report: "submitted" };
    if (p.mode === "fork") {
      // A fork tx hash means nothing to Textile: release the real inventory instead.
      rfq.report = "skipped_fork";
      await textile.cancel(firm.rfqId, firm.claimToken).catch((e: unknown) => warnings.push(`leg ${i}: fork RFQ cancel failed: ${errMsg(e)}`));
    } else {
      try {
        rfq.statusAfter = (await textile.submit(firm.rfqId, firm.claimToken, swap.hash)).status;
      } catch (err) {
        rfq.report = "submit_failed";
        rfq.error = errMsg(err);
        rfq.statusAfter = await textile
          .status(firm.rfqId, firm.claimToken)
          .then((s) => s.status)
          .catch((e: unknown) => `unknown (${errMsg(e)})`);
        warnings.push(`leg ${i}: settled onchain (${swap.hash}) but /submit failed: ${rfq.error}; status ${rfq.statusAfter}`);
      }
    }
    progress({ leg: i, venue: "textile_rfq", stage: "reported", message: `RFQ ${firm.rfqId}: ${rfq.report}`, txHash: swap.hash });

    return {
      venue: "textile_rfq",
      routeLegs: [i],
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: out,
      txHash: swap.hash,
      blockNumber: swap.receipt.blockNumber,
      attribution: attributionCodes(swap.data),
      approvalTxHash,
      rfqId: firm.rfqId,
      rfq,
    };
  };

  for (const step of steps) {
    const first = step.legIndexes[0]!;
    const stepIn = route.legs[first]!.quote.tokenIn;
    const stepOut = route.legs[step.legIndexes[step.legIndexes.length - 1]!]!.quote.tokenOut;
    try {
      const done = step.venue === "uniswap_v3" ? await runUniswap(step.legIndexes) : await runTextile(first);
      legs.push(done);
      amountIn = done.amountOut;
      if (amountIn === 0n) {
        // Confirmed but delivered nothing to the taker: stop rather than chain a zero input.
        const message = `step at leg ${first} confirmed (${done.txHash}) but delivered 0 ${sym(stepOut)} to the taker`;
        progress({ leg: first, venue: step.venue, stage: "failed", message });
        return {
          routeId: route.id,
          status: "partial",
          legs,
          finalAmountOut: 0n,
          holding: { token: stepOut, symbol: sym(stepOut), amount: 0n, certain: true },
          txs,
          error: { leg: first, venue: step.venue, stage: "swap", message },
          warnings,
        };
      }
    } catch (err) {
      if (!(err instanceof StepFailure)) throw err; // unexpected: a bug, not a venue outcome
      progress({ leg: first, venue: step.venue, stage: "failed", message: err.message });
      // After a failed step the route's funds are still the step's input (amountIn of stepIn),
      // unless a swap's outcome is unknown.
      const holding: Holding = { token: stepIn, symbol: sym(stepIn), amount: amountIn, certain: !err.uncertainTx };
      if (err.uncertainTx) {
        holding.alternative = { token: stepOut, symbol: sym(stepOut), amount: err.uncertainTx.expectedOut, txHash: err.uncertainTx.hash };
      }
      const anyDone = legs.length > 0;
      return {
        routeId: route.id,
        status: anyDone ? "partial" : "failed",
        legs,
        finalAmountOut: 0n,
        holding,
        txs,
        error: { leg: first, venue: step.venue, stage: err.stage, message: err.message },
        warnings,
      };
    }
  }

  return { routeId: route.id, status: "complete", legs, finalAmountOut: amountIn, txs, warnings };
}
