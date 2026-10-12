/**
 * The slice of the Mini App API contract the bot consumes, mirrored from
 * apps/web/src/lib/miniapp/contract.ts (the source of truth). The bot image installs only
 * @arbolito/agent's dependencies, so it can't import from apps/web at runtime. A unit test
 * (test/contract.test.ts) fails if this mirror drifts from the web contract.
 */
import { z } from "zod";

export const SYMBOLS = ["wARS", "wBRL", "USDT", "USAT", "USDC"] as const;
export const Sym = z.enum(SYMBOLS);
export type Sym = z.infer<typeof Sym>;

const Address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const Atomic = z.string().regex(/^\d+$/);
const HumanAmount = z.string().regex(/^\d+(\.\d+)?$/);
export const Lang = z.enum(["es", "pt", "en"]);

export const ApiErrorCode = z.enum([
  "bad_request",
  "no_route",
  "quote_expired",
  "price_changed",
  "needs_taker_proof",
  "not_ready",
  "rate_limited",
  "upstream",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;
export const ApiError = z.object({ error: z.object({ code: ApiErrorCode, message: z.string() }) });

export const Reference = z.object({ name: z.string(), pair: z.string(), rate: z.string(), source: z.string(), at: z.string() });

export const QuoteRequest = z.object({ from: Sym, to: Sym, amount: HumanAmount, account: Address.optional(), lang: Lang.optional() });
export type QuoteRequest = z.infer<typeof QuoteRequest>;
export const QuoteResponse = z.object({
  quoteId: z.string().uuid(),
  expiresAt: z.string(),
  from: Sym,
  to: Sym,
  amountIn: Atomic,
  expectedOut: Atomic,
  minOut: Atomic,
  rate: z.string(),
  vsOfficial: z.object({ pct: z.number(), pair: z.string(), deltaOut: z.string() }).nullable(),
  steps: z.number().int().min(1),
  venues: z.array(z.enum(["uniswap", "textile"])),
  usesTextile: z.boolean(),
  alternatives: z.array(z.object({ expectedOut: Atomic, venues: z.array(z.enum(["uniswap", "textile"])), diffBps: z.number().int() })),
  references: z.array(Reference),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

export const ReceiptStatus = z.enum(["registering", "verified", "mismatch", "failed"]);
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
export type ReceiptResponse = z.infer<typeof ReceiptResponse>;

/** Case-insensitive symbol lookup for user input ("wbrl", "usa₮" → canonical), or null. */
export function parseSym(input: string): Sym | null {
  const norm = input.trim().toLowerCase().replace("₮", "t");
  return SYMBOLS.find((s) => s.toLowerCase() === norm) ?? null;
}
