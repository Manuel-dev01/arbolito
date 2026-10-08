import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
/** Atomic amounts and block numbers as decimal strings (bigint-safe JSON). */
const uint = z.string().regex(/^\d+$/);

export const quoteSchema = z.object({
  venue: z.enum(["textile_rfq", "uniswap_v3", "textile_limit"]),
  tokenIn: address,
  tokenOut: address,
  amountIn: uint,
  amountOut: uint,
  expiresAt: z.number().int().optional(),
  blockNumber: uint,
  firm: z.boolean(),
  raw: z.unknown(),
  meta: z.object({ pool: address.optional(), fee: z.number().int().optional() }).optional(),
});

export const legSchema = z.object({ quote: quoteSchema, minOut: uint });

export const routeSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  legs: z.array(legSchema).min(1),
  tokenIn: address,
  tokenOut: address,
  amountIn: uint,
  expectedOut: uint,
  minOut: uint,
  taker: address,
});

export const referenceSchema = z.object({
  name: z.enum(["official", "mep", "ccl", "crypto", "blue", "textile_mid", "uniswap_mid"]),
  pair: z.string(),
  rate: z.string(),
  source: z.string(),
  at: z.string(),
});

export const proofBundleSchema = z.object({
  v: z.literal(1),
  routeId: z.string().min(1),
  createdAt: z.string(),
  chainId: z.literal(42220),
  request: z.object({ tokenIn: address, tokenOut: address, amountIn: uint, taker: address }),
  quotesConsidered: z.array(quoteSchema),
  chosen: routeSchema,
  /** Other complete routes the planner found, best first. */
  alternatives: z.array(routeSchema),
  references: z.array(referenceSchema),
  /** Executed vs a reference rate, in tokenOut atomic units (positive = user got more). */
  savings: z
    .object({ vs: z.string(), pair: z.string(), referenceOut: uint, executedOut: uint, delta: z.string().regex(/^-?\d+$/), bps: z.number() })
    .optional(),
  competitor: z
    .object({ provider: z.string(), rate: z.string(), screenshotSha256: z.string(), buySettlementTx: z.string() })
    .optional(),
  execution: z.object({
    txHash: hash32,
    blockNumber: uint,
    amountOut: uint,
    /** ERC-8021 codes found in the execution tx calldata. */
    attribution: z.array(z.string()),
  }),
});

export type ProofBundle = z.infer<typeof proofBundleSchema>;
