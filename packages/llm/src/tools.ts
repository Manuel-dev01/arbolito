import { z } from "zod";
import { TOKENS } from "@arbolito/config";
import type { ToolDefinition } from "./client";

/**
 * The agent's tools: zod schemas are the single source of truth; the JSON Schema sent to the
 * model is generated from them, and the same schemas validate the model's arguments.
 *
 * Autonomy policy (docs/02-product-spec.md): there is deliberately NO tool that moves funds.
 * prepare_convert / prepare_send only create a quote card; money moves only when the user
 * confirms it in their own MiniPay wallet, outside the LLM.
 */

export const TOKEN_SYMBOLS = ["wARS", "wBRL", "USDT", "USAT", "USDC"] as const;
export type TokenSymbol = (typeof TOKEN_SYMBOLS)[number];

const tokenDecimals = (t: TokenSymbol): number => TOKENS[t].decimals;

const token = z.enum(TOKEN_SYMBOLS);

/** Human units as a plain decimal string ("200", "10.5"). Never a float. */
const amount = z
  .string()
  .regex(/^(0|[1-9]\d{0,17})(\.\d{1,18})?$/, 'plain decimal with "." and no thousands separators, e.g. "200" or "10.5"')
  .refine((s) => /[1-9]/.test(s), "must be greater than zero")
  .describe('Amount in human units of the token being spent, as a plain decimal string with "." as decimal separator and no thousands separators, e.g. "200" or "10.5".');

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Rejects more fractional digits than the token supports (6 for USD tokens, 18 for wFIAT). */
function fitsDecimals(ctx: z.RefinementCtx, value: string, t: TokenSymbol, path: string) {
  const frac = value.split(".")[1] ?? "";
  if (frac.length > tokenDecimals(t)) {
    ctx.addIssue({ code: "custom", path: [path], message: `${t} supports at most ${tokenDecimals(t)} decimals` });
  }
}

const pairArgs = z
  .strictObject({
    from: token.describe("Token the user spends."),
    to: token.describe("Token the user receives."),
    amount,
  })
  .superRefine((a, ctx) => {
    if (a.from === a.to) ctx.addIssue({ code: "custom", path: ["to"], message: "from and to must differ" });
    fitsDecimals(ctx, a.amount, a.from, "amount");
  });

export const toolSchemas = {
  get_balances: z.strictObject({}),
  get_quote: pairArgs,
  prepare_convert: pairArgs,
  prepare_send: z
    .strictObject({
      recipient: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .describe("A saved contact's name exactly as the user wrote it, or a 0x address the user typed in this chat."),
      amount,
      token: token.describe("Token the user spends."),
      destinationToken: token
        .optional()
        .describe("Token the recipient should receive, when different from the one spent (e.g. send USDT, recipient gets wARS)."),
    })
    .superRefine((a, ctx) => {
      if (a.recipient.startsWith("0x") && !ADDRESS_RE.test(a.recipient)) {
        ctx.addIssue({ code: "custom", path: ["recipient"], message: "not a valid 0x address" });
      }
      fitsDecimals(ctx, a.amount, a.token, "amount");
    }),
  add_contact: z.strictObject({
    name: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[\p{L}\p{N} .'_-]+$/u, "letters, numbers, spaces and . ' _ - only")
      .describe("Contact name as the user wrote it."),
    address: z.string().regex(ADDRESS_RE, "must be a 0x address").describe("0x address the user typed in this chat."),
  }),
  list_contacts: z.strictObject({}),
  get_receipt: z.strictObject({
    id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,80}$/, "receipt id")
      .describe('Receipt id, or "last" for the user\'s most recent receipt.'),
  }),
  get_limits: z.strictObject({}),
  deposit_info: z.strictObject({ token: token.optional().describe("Token the user wants to deposit, if they said.") }),
  withdraw_guide: z.strictObject({ token: token.optional().describe("Token the user wants to cash out, if they said.") }),
  help: z.strictObject({}),
} as const;

export type ToolName = keyof typeof toolSchemas;
export const TOOL_NAMES = Object.keys(toolSchemas) as ToolName[];
export type ToolArgs = { [K in ToolName]: z.infer<(typeof toolSchemas)[K]> };

const descriptions: Record<ToolName, string> = {
  get_balances: "Read the user's wallet balances (all supported tokens). Read-only.",
  get_quote:
    "Get live quotes for converting `amount` of `from` into `to`: best route, alternatives and the official reference rate. Read-only; reserves nothing. Use it for every rate you mention.",
  prepare_convert:
    "Prepare a conversion for the user to confirm. Creates a quote card the user confirms in their own MiniPay wallet. It does NOT execute anything: money moves only when the user confirms in MiniPay.",
  prepare_send:
    "Prepare a payment to a saved contact or to an address the user typed. Creates a card the user confirms in their own MiniPay wallet. It does NOT send anything: money moves only when the user confirms in MiniPay.",
  add_contact: "Save a contact (name + 0x address) that the user dictated in this chat.",
  list_contacts: "List the user's saved contacts. Read-only.",
  get_receipt: "Fetch a verifiable receipt of a past transaction by id. Read-only.",
  get_limits: "Read the user's per-action and daily limits and how much is left today. Read-only. Limits can't be changed here.",
  deposit_info: "Show how to deposit into the user's Arbolito wallet (address, network, supported tokens).",
  withdraw_guide: "Explain how to cash out to a local bank account (off-ramp guide).",
  help: "List what Arbolito can do.",
};

function jsonSchemaFor(name: ToolName): Record<string, unknown> {
  // io "input" so optional fields stay optional; $schema is noise for the model.
  const { $schema: _drop, ...schema } = z.toJSONSchema(toolSchemas[name], { io: "input" }) as Record<string, unknown>;
  return schema;
}

/** OpenAI-format tool definitions, optionally restricted to `names`. */
export function toolDefinitions(names: readonly ToolName[] = TOOL_NAMES): ToolDefinition[] {
  return names.map((name) => ({
    type: "function",
    function: { name, description: descriptions[name], parameters: jsonSchemaFor(name) },
  }));
}

export function isToolName(name: string): name is ToolName {
  return Object.hasOwn(toolSchemas, name);
}

export type ParsedToolCall = { [K in ToolName]: { name: K; args: ToolArgs[K] } }[ToolName];

export type ParseToolArgsResult = ({ ok: true } & ParsedToolCall) | { ok: false; name: string; error: string };

/**
 * Validates a model-produced tool call. Never throws: errors are returned so the agent can
 * feed them back to the model. An empty argument string counts as `{}`.
 */
export function parseToolArgs(name: string, json: string): ParseToolArgsResult {
  if (!isToolName(name)) return { ok: false, name, error: `unknown tool "${name}"` };
  let raw: unknown;
  try {
    raw = json.trim() === "" ? {} : JSON.parse(json);
  } catch {
    return { ok: false, name, error: "arguments are not valid JSON" };
  }
  const parsed = toolSchemas[name].safeParse(raw);
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false, name, error };
  }
  return { ok: true, name, args: parsed.data } as { ok: true } & ParsedToolCall;
}
