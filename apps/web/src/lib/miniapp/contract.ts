/**
 * MiniPay Mini App ⇄ backend API contract (route handlers under /api/miniapp/*).
 *
 * Shared by the Mini App UI (consumer) and the backend (implementer). Change it only with
 * both sides in mind.
 *
 * Ground rules:
 * - The server never moves money. It quotes and returns UNSIGNED calls; the user's own MiniPay
 *   wallet signs and sends them (MiniPay's native confirmation sheet is the approval).
 * - No sign-in (MiniPay rule). Requests name the user's wallet `account`. Endpoints only prepare
 *   txs or return public data, so an untrusted `account` can't move anyone's money.
 * - Contacts (name, phone, currency) live on the phone (localStorage). Only autonomy contacts go
 *   onchain, as guard allowlist entries the user's own tx sets.
 * - Every prepared call's `data` already carries the ERC-8021 attribution suffix.
 * - Amounts are decimal strings of ATOMIC units (bigint-safe JSON). Format only at the UI edge
 *   (wFIAT 18 decimals, USD stables 6).
 * - Errors: `{ error: { code, message } }` with an HTTP status; `code` is one of ApiErrorCode.
 */
import { z } from "zod";

export const SYMBOLS = ["wARS", "wBRL", "USDT", "USAT", "USDC"] as const;
export const Sym = z.enum(SYMBOLS);
export type Sym = z.infer<typeof Sym>;

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const Atomic = z.string().regex(/^\d+$/);
/** A human decimal amount as typed by the user, e.g. "200" or "10.5" ("." separator). */
const HumanAmount = z.string().regex(/^\d+(\.\d+)?$/);
export const Lang = z.enum(["es", "pt", "en"]);

export const ApiErrorCode = z.enum([
  "bad_request",
  "no_route", // no market can quote this pair/size now
  "quote_expired", // past expiresAt: request a new quote
  "price_changed", // re-quote at prepare moved below the shown minimum
  "needs_taker_proof", // Textile firm quote needs the user's one-time proof (see PrepareResponse)
  "not_ready", // feature needs config not yet deployed (e.g. guard address)
  "rate_limited",
  "upstream", // RPC / Textile / LLM failure; nothing moved
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;
export const ApiError = z.object({ error: z.object({ code: ApiErrorCode, message: z.string() }) });

/** One unsigned call for the wallet to send, in order. */
export const Call = z.object({ to: Address, data: Hex, value: Atomic, label: z.string() });
export type Call = z.infer<typeof Call>;

// ── GET /api/miniapp/rates ─────────────────────────────────────────────────
export const Reference = z.object({ name: z.string(), pair: z.string(), rate: z.string(), source: z.string(), at: z.string() });
export const RatesResponse = z.object({ at: z.string(), references: z.array(Reference) });

// ── GET /api/miniapp/balances?account=0x… ──────────────────────────────────
export const BalancesResponse = z.object({
  account: Address,
  balances: z.array(z.object({ sym: Sym, amount: Atomic, decimals: z.number().int() })),
  /** Approximate USD value of each balance (micro-USD), for totals in the display currency. */
  usdMicros: z.record(Sym, Atomic),
  blockNumber: Atomic,
});

// ── POST /api/miniapp/quote ────────────────────────────────────────────────
export const QuoteRequest = z.object({ from: Sym, to: Sym, amount: HumanAmount, account: Address.optional(), lang: Lang.optional() });
export const QuoteResponse = z.object({
  quoteId: z.string().uuid(),
  /** ISO time; the card counts down to it and dims after. */
  expiresAt: z.string(),
  from: Sym,
  to: Sym,
  amountIn: Atomic,
  expectedOut: Atomic,
  /** Guaranteed minimum after slippage ("Mínimo garantizado"). */
  minOut: Atomic,
  /** to-units per 1 from-unit, decimal string ("317.74"). */
  rate: z.string(),
  /** vs the official reference for this pair; null if none. deltaOut is in `to` atomic units. */
  vsOfficial: z.object({ pct: z.number(), pair: z.string(), deltaOut: z.string() }).nullable(),
  /** Plain-language route: number of steps and venues ("2 pasos, por el mejor mercado"). */
  steps: z.number().int().min(1),
  venues: z.array(z.enum(["uniswap", "textile"])),
  /** True if executing needs a Textile firm quote (and possibly the one-time taker proof). */
  usesTextile: z.boolean(),
  alternatives: z.array(z.object({ expectedOut: Atomic, venues: z.array(z.enum(["uniswap", "textile"])), diffBps: z.number().int() })),
  references: z.array(Reference),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

// ── GET /api/miniapp/quotes/open?account=0x… ───────────────────────────────
/**
 * The user's most recent still-open quote (status quoted, unexpired), e.g. one created from
 * Telegram. MiniPay's mini-app deeplink (link.minipay.xyz/miniapp?id=…) may drop our query
 * params, so on open the Mini App resumes this instead of relying on ?quote=.
 */
export const OpenQuoteResponse = z.object({ quote: QuoteResponse.nullable() });

// ── POST /api/miniapp/prepare ──────────────────────────────────────────────
/** Turn a live quote into calls for the user's wallet. Textile routes take a firm quote here. */
export const TakerProof = z.object({ nonce: Hex, issuedAt: z.number().int(), signature: Hex, scheme: z.enum(["eip712", "eip191"]) });
export const PrepareRequest = z.object({ quoteId: z.string().uuid(), account: Address, takerProof: TakerProof.optional() });
export const PrepareResponse = z.object({
  quoteId: z.string().uuid(),
  /** Send in order; wait for each receipt before the next (approval first if needed). */
  calls: z.array(Call),
  /** Firm-quote deadline for Textile routes (earlier than the quote's expiresAt). */
  expiresAt: z.string(),
  expectedOut: Atomic,
  minOut: Atomic,
});
/**
 * 409 needs_taker_proof body: what the wallet must sign (once per ~12 h) before retrying
 * /prepare with `takerProof`. EIP-712 by default; `eip191Message` when typed data isn't supported.
 */
export const NeedsTakerProof = z.object({
  error: z.object({ code: z.literal("needs_taker_proof"), message: z.string() }),
  typedData: z.unknown(),
  eip191Message: z.string(),
  nonce: Hex,
  issuedAt: z.number().int(),
});

// ── POST /api/miniapp/send/prepare ─────────────────────────────────────────
/**
 * Send to a contact. Same currency: one transfer, no quote. Cross currency: the live quote
 * (from /quote, same pair and amount) is prepared with the contact as recipient; submit it with
 * /submit like a conversion, and its receipt names the recipient.
 */
export const SendPrepareRequest = z.object({ account: Address, recipient: Address, from: Sym, to: Sym, amount: HumanAmount, quoteId: z.string().uuid().optional() });
export const SendPrepareResponse = z.object({ calls: z.array(Call), expectedOut: Atomic, minOut: Atomic, quoteId: z.string().uuid().optional() });

// ── POST /api/miniapp/submit ───────────────────────────────────────────────
/** After the wallet sent the calls: register the result, build and anchor the receipt. */
export const SubmitRequest = z.object({ quoteId: z.string().uuid(), account: Address, txHashes: z.array(Hex).min(1) });
export const ReceiptStatus = z.enum(["registering", "verified", "mismatch", "failed"]);
export const SubmitResponse = z.object({ receiptId: z.string().uuid(), status: ReceiptStatus, url: z.string() });

// ── GET /api/miniapp/receipt/:id ───────────────────────────────────────────
export const ReceiptResponse = z.object({
  receiptId: z.string().uuid(),
  status: ReceiptStatus,
  url: z.string(),
  from: Sym,
  to: Sym,
  amountIn: Atomic,
  amountOut: Atomic,
  savings: z.object({ pct: z.number(), deltaOut: z.string(), pair: z.string() }).nullable(),
  executionTx: Hex,
  anchorTx: Hex.nullable(),
  createdAt: z.string(),
});

// ── GET /api/miniapp/receipts?account=0x… ─────────────────────────────────
/** The wallet's receipts, newest first (up to 50): a send names its recipient wallet. */
export const ReceiptsListResponse = z.object({
  receipts: z.array(
    z.object({ receiptId: z.string().uuid(), kind: z.enum(["change", "send"]), recipient: Address.nullable(), at: z.string(), from: Sym, to: Sym, amountIn: Atomic, amountOut: Atomic }),
  ),
});

// ── Autonomy ("Dejá que Arbolito actúe por vos") via ArbolitoGuard v2 ──────
export const TokenLimit = z.object({ sym: Sym, perTx: Atomic, perDay: Atomic });
/** POST /api/miniapp/autonomy/plan → calls: bounded approvals to the guard, setOperator, configure. */
export const AutonomyPlanRequest = z.object({
  account: Address,
  limits: z.array(TokenLimit).min(1),
  /** Contact wallets the operator may pay (already resolved from phone numbers on the phone). */
  contacts: z.array(Address),
  maxSlippageBps: z.number().int().min(1).max(1000),
  operatorDays: z.number().int().min(1).max(365),
});
export const CallsResponse = z.object({ calls: z.array(Call) });
/** GET /api/miniapp/autonomy/status?account= */
export const AutonomyStatus = z.object({
  account: Address,
  configured: z.boolean(),
  paused: z.boolean(),
  operatorActive: z.boolean(),
  operatorExpiry: z.string().nullable(),
  maxSlippageBps: z.number().int(),
  limits: z.array(TokenLimit.extend({ spentToday: Atomic })),
  contacts: z.array(Address),
});
/** POST /api/miniapp/autonomy/revoke-plan { account } → calls: revokeOperator + approvals back to 0. */
export const RevokePlanRequest = z.object({ account: Address });

// ── POST /api/miniapp/chat ─────────────────────────────────────────────────
/** One chat turn in the mini app (text, or a voice note as base64). Rate-limited per account. */
export const ChatRequest = z.object({
  account: Address,
  lang: Lang,
  text: z.string().max(1000).optional(),
  audioBase64: z.string().max(8_000_000).optional(),
  audioMime: z.string().optional(),
});
export const ChatResponse = z.object({
  transcript: z.string().nullable(),
  reply: z.string(),
  /** Quote cards to render under the reply; Confirm goes through /prepare like the Change flow. */
  quotes: z.array(QuoteResponse),
});

// ── Telegram linking ("Conectá tu MiniPay": 4-digit code shown in both apps) ──
/** POST /api/miniapp/link/confirm { code, account, proof? } — proof format decided by the MiniPay check. */
export const LinkConfirmRequest = z.object({ code: z.string().regex(/^\d{4}$/), account: Address, proof: Hex.optional() });
export const LinkConfirmResponse = z.object({ linked: z.boolean(), telegramName: z.string().nullable() });
