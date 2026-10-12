import type { Address } from "viem";
import type { z } from "zod";
import { CELO_MAINNET_ID, TOKENS, tokenByAddress } from "@arbolito/config";
import { formatUsd } from "@arbolito/chain";
import { LlmConfigError, LlmError, TOKEN_SYMBOLS, ToolUserError, runAgentTurn, type ToolHandlers } from "@arbolito/llm";
import { effectiveRate, fiatOf, fmtAmount, referenceRate } from "@arbolito/router";
import type { ChatRequest, ChatResponse, QuoteResponse } from "../contract";
import type { MiniappDeps } from "./deps";
import { ApiFailure, badRequest, notReady, rateLimited, upstream } from "./errors";
import { logError } from "./http";
import { readBalances } from "./market";
import { createQuote, parseAmount, planQuote, type PlannedQuote } from "./quote";
import type { UserRow } from "./store";

/** Turns per wallet and per IP per minute (each turn can cost an LLM call and an STT call). */
const CHAT_LIMIT_ACCOUNT = 8;
const CHAT_LIMIT_IP = 30;
const CHAT_WINDOW_MS = 60_000;
const HISTORY_LIMIT = 20;
const NO_ROUTE = "No market can quote that pair and size right now.";

// ── Ripio ramp deep links (mirrors apps/agent/src/ripio.ts; no credentials) ──
const RAMP = "https://ramp.ripio.com";
const COUNTRY: Record<string, "AR" | "BR"> = { wARS: "AR", wBRL: "BR" };
const TICKER: Record<string, string> = { wARS: "WARS", wBRL: "WBRL", USDT: "USDT", USDC: "USDC", USAT: "USAT" };

export function rampLink(direction: "on" | "off", token: string, address: string): string {
  const q = new URLSearchParams({ country: COUNTRY[token] ?? "AR", chain: String(CELO_MAINNET_ID), token: TICKER[token] ?? token, address });
  return `${RAMP}${direction === "off" ? "/offramp" : "/"}?${q.toString()}`;
}

function summarize(q: PlannedQuote) {
  const r = q.route;
  const [base, qt] = [fiatOf(tokenByAddress(r.tokenIn).symbol), fiatOf(tokenByAddress(r.tokenOut).symbol)];
  const rate = effectiveRate(r.tokenIn, r.amountIn, r.tokenOut, r.expectedOut);
  const official = referenceRate(q.references, "official", base, qt);
  return {
    youPay: fmtAmount(r.tokenIn, r.amountIn),
    youGet: fmtAmount(r.tokenOut, r.expectedOut),
    guaranteedMinimum: fmtAmount(r.tokenOut, r.minOut),
    rate: `1 ${base} = ${rate.toPrecision(6)} ${qt}`,
    vsOfficialPercent: official ? Number(((rate / official - 1) * 100).toFixed(2)) : null,
    route: r.label,
    alternativesConsidered: q.alternatives.length,
  };
}

const asToolError = (err: unknown): never => {
  if (err instanceof ApiFailure && err.code === "no_route") throw new ToolUserError(NO_ROUTE, "no_route");
  if (err instanceof ApiFailure && err.code === "bad_request") throw new ToolUserError(err.message, "bad_request");
  throw err;
};

/**
 * Tool handlers for one MiniPay wallet (mirrors apps/agent/src/tools.ts). Nothing here moves
 * funds: prepare_convert stores a quote the Mini App renders as a card; Confirm goes through
 * /prepare and the user's own MiniPay confirmation.
 */
export function buildChatHandlers(deps: MiniappDeps, user: UserRow, account: Address, lang: string, quotes: z.infer<typeof QuoteResponse>[]): ToolHandlers {
  return {
    async get_balances() {
      const { balances } = await readBalances(deps, account);
      return { data: { wallet: account, balances: balances.map((b) => ({ token: b.sym, amount: fmtAmount(TOKENS[b.sym].address, b.amount) })) } };
    },

    async get_quote(args) {
      try {
        return { data: summarize(await planQuote(deps, args.from, args.to, parseAmount(args.from, args.amount), account)) };
      } catch (err) {
        return asToolError(err);
      }
    },

    async prepare_convert(args) {
      let q: z.infer<typeof QuoteResponse>;
      try {
        q = await createQuote(deps, { from: args.from, to: args.to, amount: args.amount, account, lang: lang as "es" | "pt" | "en" });
      } catch (err) {
        return asToolError(err);
      }
      quotes.push(q);
      return {
        data: {
          status: "pending_confirmation",
          note: "A quote card with a Confirm button is shown in the app; confirming opens the MiniPay confirmation. Nothing has moved.",
          youPay: fmtAmount(TOKENS[q.from].address, BigInt(q.amountIn)),
          youGet: fmtAmount(TOKENS[q.to].address, BigInt(q.expectedOut)),
          guaranteedMinimum: fmtAmount(TOKENS[q.to].address, BigInt(q.minOut)),
          rate: `1 ${q.from} = ${q.rate} ${q.to}`,
          vsOfficialPercent: q.vsOfficial?.pct ?? null,
          expiresAt: q.expiresAt,
        },
        card: { kind: "convert", id: q.quoteId },
      };
    },

    async get_limits() {
      return {
        data: {
          perAction: formatUsd(BigInt(user.maxActionMicros)),
          perDay: formatUsd(BigInt(user.maxDailyMicros)),
          note: "Every conversion is confirmed in MiniPay. Autonomy limits are set in the app, never in chat.",
        },
      };
    },

    async deposit_info(args) {
      const tokens = args.token ? [args.token] : (["wARS", "wBRL", "USDT"] as const);
      return {
        data: {
          address: account,
          network: "Celo",
          ripio: tokens.map((t) => ({ token: t, link: rampLink("on", t, account) })),
          other: "USDT, USDC or USA₮ can also be sent to this address on the Celo network, or added with MiniPay's own Deposit.",
        },
      };
    },

    async withdraw_guide(args) {
      const token = args.token ?? "wARS";
      return {
        data: {
          ripioOffRamp: rampLink("off", token, account),
          steps: "Open the link; Ripio handles identity checks and pays out to the user's local bank account.",
        },
      };
    },

    async help() {
      return {
        data: {
          can: ["check balances", "quote and convert pesos, reais and dollars", "deposit and cash-out links via Ripio", "show receipts after a conversion"],
          tokens: TOKEN_SYMBOLS,
        },
      };
    },
  };
}

const EXT: Record<string, string> = { "audio/ogg": "ogg", "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a" };

/** POST /chat: one agent turn (text or a voice note). */
export async function chatTurn(deps: MiniappDeps, req: z.infer<typeof ChatRequest>, ip: string): Promise<z.infer<typeof ChatResponse>> {
  const account = req.account.toLowerCase() as Address;
  if (!req.text?.trim() && !req.audioBase64) throw badRequest("Send text or a voice note.");
  if (!deps.limiter.take(`chat:acct:${account}`, CHAT_LIMIT_ACCOUNT, CHAT_WINDOW_MS) || !deps.limiter.take(`chat:ip:${ip}`, CHAT_LIMIT_IP, CHAT_WINDOW_MS)) {
    throw rateLimited();
  }

  let transcript: string | null = null;
  if (req.audioBase64) {
    const audio = Buffer.from(req.audioBase64, "base64");
    if (audio.byteLength === 0) throw badRequest("The voice note is empty.");
    const mime = (req.audioMime ?? "audio/webm").split(";")[0]!.trim().toLowerCase();
    try {
      transcript = (await deps.transcribe(new Uint8Array(audio), { filename: `voice.${EXT[mime] ?? "webm"}`, mimeType: mime, language: req.lang })).text.trim();
    } catch (err) {
      if (err instanceof LlmConfigError) throw notReady("Voice notes are not configured.");
      logError("chat transcribe", err);
      throw upstream("Couldn't transcribe the voice note. Try again or type it.");
    }
    if (!transcript) throw badRequest("Couldn't hear anything in the voice note.");
  }
  const userText = [req.text?.trim(), transcript].filter(Boolean).join("\n");

  const store = deps.store();
  const user = await store.walletUser(account, req.lang);
  const history = await store.loadHistory(user.id, HISTORY_LIMIT);
  const quotes: z.infer<typeof QuoteResponse>[] = [];
  let result;
  try {
    result = await runAgentTurn({
      history,
      userText,
      language: req.lang,
      tools: buildChatHandlers(deps, user, account, req.lang, quotes),
      model: deps.agentModel,
      client: deps.llm(),
    });
  } catch (err) {
    if (err instanceof LlmConfigError) throw notReady("Chat is not configured.");
    if (err instanceof LlmError) {
      logError("chat llm", err);
      throw upstream("The assistant is not answering right now. Try again.");
    }
    throw err;
  }
  await store.appendHistory(user.id, result.messages);
  return { transcript, reply: result.text, quotes };
}
