import { encodeFunctionData, recoverMessageAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import type { z } from "zod";
import { CONTRACTS } from "@arbolito/config";
import { withAttribution } from "@arbolito/chain";
import {
  TextileApiError,
  buildRouteCalls,
  erc20Abi,
  parseExpiry,
  takerControlMessage,
  takerControlNonce,
  takerControlTypedData,
  type Route,
  type TextileFirm,
  type VenueAdapter,
} from "@arbolito/router";
import type { PrepareRequest, PrepareResponse, TakerProof } from "../contract";
import type { MiniappDeps } from "./deps";
import { ApiFailure, badRequest, noRoute, notFound, notReady, priceChanged, quoteExpired, upstream } from "./errors";
import { logError, logTextileError } from "./http";
import { routeKind } from "./quote";
import { decodePayload } from "./serde";
import type { MiniappStore, QuoteRow } from "./store";

/** A call as stored in miniapp_quotes.prepared. `core` is the calldata before the attribution suffix. */
export interface StoredCall {
  to: Address;
  data: Hex;
  core: Hex;
  value: string;
  label: string;
}

/** Set on a send: who receives the output, and which call is the swap (a Textile send ends with a forwarding transfer). */
interface SendFields {
  recipient?: Address;
  swapIndex?: number;
}

export interface PreparedUniswap extends SendFields {
  kind: "uniswap";
  calls: StoredCall[];
  blockNumber: string;
  expectedOut: string;
  minOut: string;
  expiresAt: string;
}

/** Firm Textile quote. claimToken is a bearer capability: server-side only, never returned or logged. */
export interface PreparedTextile extends SendFields {
  kind: "textile";
  calls: StoredCall[];
  rfqId: string;
  claimToken: string;
  expiresAt: string;
  orderDeadline: string;
  buyAmount: string;
  takerPays: string;
  /** The firm quote minus the claim token, kept for the ProofBundle. */
  firm: Record<string, unknown>;
  report?: { status: "submitted" | "submit_failed"; statusAfter?: string; error?: string };
}

export type Prepared = PreparedUniswap | PreparedTextile;

/** A firm quote must have at least this long left when handed to the wallet (two sends + receipts). */
export const FIRM_MARGIN_MS = 20_000;
/** Textile's validity windows for a TakerControl proof. */
const PROOF_WINDOW_MS = { eip712: 60_000, eip191: 5 * 60_000 } as const;

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function tagged(deps: MiniappDeps, call: { to: Address; data: Hex; value: bigint; label: string }): StoredCall {
  if (!deps.attributionCode) throw notReady("ATTRIBUTION_CODE is not configured; every transaction must carry it.");
  return { to: call.to, data: withAttribution(call.data, deps.attributionCode), core: call.data, value: call.value.toString(), label: call.label };
}

export const publicCalls = (calls: StoredCall[]) => calls.map(({ to, data, value, label }) => ({ to, data, value, label }));

/** The quote, owned by `account`, still live. Binds an anonymous quote to the account. */
export async function loadLiveQuote(deps: MiniappDeps, store: MiniappStore, quoteId: string, account: Address): Promise<QuoteRow> {
  const row = await store.getQuote(quoteId);
  if (!row) throw notFound("Quote not found.");
  if (row.account && !eq(row.account, account)) throw badRequest("This quote belongs to another wallet.", 403);
  return row;
}

/**
 * Failures that end a quote: /prepare marks it `failed` with this `error` (the Telegram bot reads
 * miniapp_quotes to keep its cards in sync). Transient failures (network, a needed proof) leave
 * it `quoted` so the user can retry within its expiry.
 */
const quoteError = new WeakMap<ApiFailure, string>();
const final = (f: ApiFailure, error: string): ApiFailure => {
  quoteError.set(f, error);
  return f;
};

/** Chains the Uniswap adapter through the route's legs at the latest block. Null if any leg can't quote. */
async function requoteUniswap(deps: MiniappDeps, route: Route): Promise<bigint | null> {
  const uni = deps.adapters.find((a): a is VenueAdapter => a.venue === "uniswap_v3");
  if (!uni) throw notReady("Uniswap adapter is not configured.");
  const blockNumber = await deps.chain.getBlockNumber();
  let amount = route.amountIn;
  for (const leg of route.legs) {
    const q = await uni.quote({ tokenIn: leg.quote.tokenIn, tokenOut: leg.quote.tokenOut, amountIn: amount, taker: route.taker, blockNumber });
    if (!q) return null;
    amount = q.amountOut;
  }
  return amount;
}

const allowance = (deps: MiniappDeps, token: Address, owner: Address, spender: Address) =>
  deps.chain.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, spender] });

/** The 409 needs_taker_proof challenge: EIP-712 typed data (eth_signTypedData_v4 JSON) and the eip191 text. */
export function takerProofChallenge(deps: MiniappDeps, account: Address, message: string): ApiFailure {
  const nonce = takerControlNonce();
  const issuedAt = deps.now();
  const td = takerControlTypedData(account, deps.chainId, nonce, issuedAt);
  const typedData = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      ...td.types,
    },
    primaryType: td.primaryType,
    domain: td.domain,
    message: { taker: account, chainId: deps.chainId, nonce, issuedAt },
  };
  return new ApiFailure("needs_taker_proof", message, 409, {
    typedData,
    eip191Message: takerControlMessage(account, deps.chainId, nonce, issuedAt),
    nonce,
    issuedAt,
  });
}

/** Local check before spending a Textile call: the proof is fresh and recovers to the account (EOA). */
async function checkTakerProof(deps: MiniappDeps, account: Address, proof: z.infer<typeof TakerProof>): Promise<void> {
  const age = deps.now() - proof.issuedAt;
  if (age > PROOF_WINDOW_MS[proof.scheme] || age < -60_000) throw takerProofChallenge(deps, account, "The wallet proof expired. Sign the new one.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(proof.nonce)) throw badRequest("takerProof.nonce must be 32 bytes.");
  let signer: Address;
  try {
    signer =
      proof.scheme === "eip191"
        ? await recoverMessageAddress({ message: takerControlMessage(account, deps.chainId, proof.nonce as Hex, proof.issuedAt), signature: proof.signature as Hex })
        : await recoverTypedDataAddress({ ...takerControlTypedData(account, deps.chainId, proof.nonce as Hex, proof.issuedAt), signature: proof.signature as Hex });
  } catch {
    throw badRequest("takerProof.signature is malformed.");
  }
  if (!eq(signer, account)) throw badRequest("takerProof was not signed by this wallet.");
}

/** Textile error body → its machine code, without echoing the body. */
function textileCode(err: TextileApiError): string {
  try {
    const j = JSON.parse(err.body) as { error?: { code?: string } | string; code?: string };
    const c = typeof j.error === "string" ? j.error : (j.error?.code ?? j.code);
    if (c && /^[a-z0-9_]{1,64}$/i.test(c)) return c;
  } catch {
    /* not JSON */
  }
  return /proof_of_control_required/.test(err.body) ? "proof_of_control_required" : /corridor_unavailable/.test(err.body) ? "corridor_unavailable" : `http_${err.status}`;
}

async function prepareUniswap(deps: MiniappDeps, route: Route, account: Address, row: QuoteRow, recipient?: Address): Promise<PreparedUniswap> {
  const fresh = await requoteUniswap(deps, route);
  if (fresh === null || fresh < route.minOut) throw final(priceChanged(), "price_changed");
  // On a send, the swap pays the contact directly (the router's recipient), in the same transaction.
  const [approve, swap] = buildRouteCalls(route, recipient ?? account) as [
    { to: Address; data: Hex; value: bigint; label: string },
    { to: Address; data: Hex; value: bigint; label: string },
  ];
  const calls: StoredCall[] = [];
  if ((await allowance(deps, route.tokenIn, account, swap.to)) < route.amountIn) calls.push(tagged(deps, approve));
  calls.push(tagged(deps, swap));
  return {
    kind: "uniswap",
    calls,
    ...(recipient ? { recipient, swapIndex: calls.length - 1 } : {}),
    blockNumber: (await deps.chain.getBlockNumber()).toString(),
    expectedOut: fresh.toString(),
    minOut: route.minOut.toString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

async function prepareTextile(
  deps: MiniappDeps,
  route: Route,
  account: Address,
  proof: z.infer<typeof TakerProof> | undefined,
  /** The quote's own expiresAt (ms): the prepared deadline never runs past it. */
  quoteDeadlineMs: number,
  recipient?: Address,
): Promise<PreparedTextile> {
  const leg = route.legs[0]!;
  if (!deps.textile.hasPartnerKey) {
    if (!proof) throw takerProofChallenge(deps, account, "Sign once to let Textile quote for your wallet (no money moves).");
    await checkTakerProof(deps, account, proof);
  }

  let firm: TextileFirm;
  try {
    // Never retried: a lost response may still have reserved inventory (it expires on its own).
    firm = await deps.textile.request({
      chainId: deps.chainId,
      sellToken: leg.quote.tokenIn,
      buyToken: leg.quote.tokenOut,
      sellAmount: route.amountIn,
      taker: account,
      ...(proof && !deps.textile.hasPartnerKey ? { takerProof: { nonce: proof.nonce as Hex, issuedAt: proof.issuedAt, signature: proof.signature as Hex, scheme: proof.scheme } } : {}),
    });
  } catch (err) {
    if (err instanceof TextileApiError) {
      const code = textileCode(err);
      if (err.status === 401 || code === "proof_of_control_required") throw takerProofChallenge(deps, account, "Textile needs a fresh wallet proof. Sign again.");
      if (code === "corridor_unavailable") throw final(noRoute(), "no_route");
      if (err.status >= 400 && err.status < 500) throw final(badRequest(`Textile declined the firm quote (${code}).`, 422), `textile_${code}`);
    }
    logError("prepare textile request", err);
    throw upstream("Textile did not answer. Nothing moved; try again.");
  }

  if (firm.status !== "quoted" || !firm.quote || !firm.transactions) throw final(noRoute("No maker can fill this size right now."), "no_route");
  const q = firm.quote;
  const swapTx = firm.transactions.swap;
  const reactor = CONTRACTS.textile.limitOrderReactor;
  const buyAmount = BigInt(q.buyAmount);
  const takerPays = BigInt(q.takerPays);

  const cancel = async (failure: ApiFailure, error: string): Promise<never> => {
    await deps.textile.cancel(firm.rfqId, firm.claimToken).catch((e: unknown) => logTextileError("prepare textile cancel", e));
    throw final(failure, error);
  };
  // Same checks as executeRoute, before anything reaches the wallet. Any failure releases the inventory.
  if (!eq(q.taker, account)) await cancel(upstream("Textile bound the quote to another wallet."), "textile_bad_quote");
  if (BigInt(q.sellAmount) !== route.amountIn) await cancel(upstream("Textile quoted a different size."), "textile_bad_quote");
  if (takerPays > route.amountIn) await cancel(upstream("Textile asked for more than the amount."), "textile_bad_quote");
  if (!eq(q.spender, reactor) || !eq(swapTx.to, reactor)) await cancel(upstream("Textile returned an unexpected contract."), "textile_bad_quote");
  if (swapTx.chainId !== deps.chainId || BigInt(swapTx.value) !== 0n) await cancel(upstream("Textile returned an unexpected transaction."), "textile_bad_quote");
  if (buyAmount < route.minOut) await cancel(priceChanged(), "price_changed");
  // Effective deadline: the firm quote's expiry, clamped to the quote card's own expiresAt.
  const expiresMs = Math.min(parseExpiry(q.expiresAt), quoteDeadlineMs);
  if (expiresMs - deps.now() < FIRM_MARGIN_MS) await cancel(quoteExpired("The firm quote is about to expire. Ask for a new one."), "firm_quote_expiring");

  const calls: StoredCall[] = [];
  const have = await allowance(deps, leg.quote.tokenIn, account, q.spender as Address).catch(async (e: unknown) => {
    await deps.textile.cancel(firm.rfqId, firm.claimToken).catch((c: unknown) => logTextileError("prepare textile cancel", c));
    throw e;
  });
  if (have < takerPays) {
    // Our own exact approve (takerPays to the verified reactor), not the API's approval calldata.
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [q.spender as Address, takerPays] });
    calls.push(tagged(deps, { to: leg.quote.tokenIn, data, value: 0n, label: "approve to Textile reactor" }));
  }
  calls.push(tagged(deps, { to: swapTx.to as Address, data: swapTx.data as Hex, value: 0n, label: "Textile reactor executeBatch" }));
  const swapIndex = calls.length - 1;
  if (recipient) {
    // Textile settles to the taker only. A firm fill is exact, so forwarding exactly buyAmount is safe.
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, buyAmount] });
    calls.push(tagged(deps, { to: leg.quote.tokenOut, data, value: 0n, label: "send to contact" }));
  }

  const { claimToken: _claim, ...firmPublic } = firm;
  return {
    kind: "textile",
    calls,
    ...(recipient ? { recipient, swapIndex } : {}),
    rfqId: firm.rfqId,
    claimToken: firm.claimToken,
    expiresAt: new Date(expiresMs).toISOString(),
    orderDeadline: q.orderDeadline,
    buyAmount: buyAmount.toString(),
    takerPays: takerPays.toString(),
    firm: firmPublic as Record<string, unknown>,
  };
}

function toResponse(quoteId: string, p: Prepared): z.infer<typeof PrepareResponse> {
  return {
    quoteId,
    calls: publicCalls(p.calls),
    expiresAt: p.expiresAt,
    expectedOut: p.kind === "textile" ? p.buyAmount : p.expectedOut,
    // A firm Textile fill is exact: the guaranteed minimum is the quoted amount.
    minOut: p.kind === "textile" ? p.buyAmount : p.minOut,
  };
}

/** POST /prepare: unsigned, attribution-tagged calls for the user's wallet. */
export async function prepareQuote(deps: MiniappDeps, req: z.infer<typeof PrepareRequest>, opts: { recipient?: Address } = {}): Promise<z.infer<typeof PrepareResponse>> {
  const account = req.account.toLowerCase() as Address;
  const store = deps.store();
  const row = await loadLiveQuote(deps, store, req.quoteId, account);
  // Only a `quoted` quote can be prepared: prepared, submitted, failed, or cancelled from Telegram
  // (expired / cancelled_in_telegram) all mean "ask for a new quote".
  if (row.status !== "quoted") throw quoteExpired();
  if (deps.now() > row.expiresAt.getTime()) {
    await store.updateQuote(row.id, { status: "expired", error: "expired" }, ["quoted"]);
    throw quoteExpired();
  }

  const { route } = decodePayload(row.payload);
  const kind = routeKind(route);
  let prepared: Prepared;
  try {
    if (kind === "uniswap") prepared = await prepareUniswap(deps, route, account, row, opts.recipient);
    else if (kind === "textile") {
      if (!deps.textileEnabled) throw final(notReady("Textile execution is not enabled yet."), "textile_disabled");
      prepared = await prepareTextile(deps, route, account, req.takerProof, row.expiresAt.getTime(), opts.recipient);
    } else throw final(noRoute("This route can't be executed from a wallet in one go."), "no_route");
  } catch (err) {
    const error = err instanceof ApiFailure ? quoteError.get(err) : undefined;
    if (error) await store.updateQuote(row.id, { status: "failed", error }, ["quoted"]);
    throw err;
  }

  const ok = await store
    .updateQuote(row.id, { status: "prepared", prepared, account, ...(Date.parse(prepared.expiresAt) < row.expiresAt.getTime() ? { expiresAt: new Date(prepared.expiresAt) } : {}) }, ["quoted"])
    .catch(async (e: unknown) => {
      // The firm quote holds maker inventory: release it rather than leave the user's retry to fail.
      if (prepared.kind === "textile") await deps.textile.cancel(prepared.rfqId, prepared.claimToken).catch((c: unknown) => logTextileError("prepare cancel", c));
      throw e;
    });
  if (!ok) {
    if (prepared.kind === "textile") await deps.textile.cancel(prepared.rfqId, prepared.claimToken).catch((e: unknown) => logTextileError("prepare cancel", e));
    throw badRequest("This quote changed state; ask for a new one.", 409);
  }
  return toResponse(row.id, prepared);
}
