import { randomUUID } from "node:crypto";
import { formatUnits, type Address } from "viem";
import type { z } from "zod";
import { CELO_MAINNET_ID, TOKENS, tokenByAddress } from "@arbolito/config";
import { formatUsd, readGuardV2Budget } from "@arbolito/chain";
import { LlmConfigError, LlmError, TOKEN_SYMBOLS, ToolUserError, detectLanguage, runAgentTurn, type ToolHandlers } from "@arbolito/llm";
import { parseRule } from "@arbolito/rules";
import { erc20Abi, effectiveRate, fiatOf, fmtAmount, referenceRate } from "@arbolito/router";
import type { ChatRequest, ChatResponse, ChatSend, QuoteResponse, RuleCard, Sym } from "../contract";
import { DOLLAR_FEE_RESERVE } from "../contract";
import type { MiniappDeps } from "./deps";
import { ApiFailure, badRequest, notReady, rateLimited, upstream } from "./errors";
import { checkFeeReserve, networkFeeBalance } from "./fees";
import { logError } from "./http";
import { readBalances } from "./market";
import { createQuote, parseAmount, planQuote, type PlannedQuote } from "./quote";
import { draftRule, listRulesRes } from "./rules";
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
  if (err instanceof ApiFailure && ["via_dollars", "fee_reserve", "network_fee_required", "funds_reserved"].includes(err.code)) throw new ToolUserError(err.message, err.code);
  if (err instanceof ApiFailure && err.code === "no_route") throw new ToolUserError(NO_ROUTE, "no_route");
  if (err instanceof ApiFailure && err.code === "bad_request") throw new ToolUserError(err.message, "bad_request");
  if (err instanceof ApiFailure && err.code === "not_ready") throw new ToolUserError(err.message, "not_ready");
  if (err instanceof ApiFailure && err.code === "below_minimum") throw new ToolUserError(err.message, "below_minimum");
  throw err;
};

/**
 * Tool handlers for one MiniPay wallet (mirrors apps/agent/src/tools.ts). Nothing here moves
 * funds: prepare_convert stores a quote the Mini App renders as a card; Confirm goes through
 * /prepare and the user's own MiniPay confirmation.
 */
/** Accent- and case-insensitive name match ("mama" finds "Mamá"). */
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();

export interface ChatContext {
  /** The phone's contacts that have a wallet. */
  contacts: { name: string; address: string | null; receive?: z.infer<typeof Sym> }[];
  sends?: z.infer<typeof ChatSend>[];
  /** Only addresses supplied by user messages, never tool/assistant output. */
  userAddresses?: string[];
  /** Rule drafts made this turn (rendered as cards). */
  rules: z.infer<typeof RuleCard>[];
}

export function buildChatHandlers(
  deps: MiniappDeps,
  user: UserRow,
  account: Address,
  lang: string,
  quotes: z.infer<typeof QuoteResponse>[],
  ctx: ChatContext = { contacts: [], rules: [] },
): ToolHandlers {
  const ruleResult = (card: z.infer<typeof RuleCard>) => {
    ctx.rules.push(card);
    return {
      data: { status: "pending_signature", rule: card.description, note: "A rule card is shown in the app; the user turns it on by signing it in MiniPay. Nothing runs until then." },
      card: { kind: "rule", id: card.ruleId },
    };
  };
  return {
    async get_balances() {
      const { balances } = await readBalances(deps, account);
      const feeBalance = await networkFeeBalance(deps, account);
      return { data: { wallet: account, balances: balances.map((b) => ({ token: b.sym, amount: fmtAmount(TOKENS[b.sym].address, b.amount) })), maximumSend: Object.fromEntries(balances.map((b) => [b.sym, formatUnits(TOKENS[b.sym].kind === "usd" ? (b.amount > DOLLAR_FEE_RESERVE ? b.amount - DOLLAR_FEE_RESERVE : 0n) : b.amount, TOKENS[b.sym].decimals)])), networkFees: { availableMicros: feeBalance.toString(), recommendedMinDollars: "0.05", ready: feeBalance >= 50_000n, note: "MiniPay needs a dollar stablecoin balance for network fees even when selling pesos. If ready is false, ask the user to add dollars in MiniPay before confirming." } } };
    },

    async get_quote(args) {
      try {
        return { data: summarize(await planQuote(deps, args.from, args.to, parseAmount(args.from, args.amount), account)) };
      } catch (err) {
        if (err instanceof ApiFailure && err.code === "via_dollars") {
          const first = await planQuote(deps, args.from, "USDT", parseAmount(args.from, args.amount), account);
          return { data: { status: "two_steps_required", firstStep: summarize(first), finalDestination: args.to, note: "This is not an outage. First convert to USDT. Only after that confirms, refresh balances and prepare the destination conversion with a fresh rate. Do not promise both cards now or a locked final amount." } };
        }
        return asToolError(err);
      }
    },

    async prepare_convert(args) {
      let q: z.infer<typeof QuoteResponse>;
      let finalDestination: string | null = null;
      try {
        q = await createQuote(deps, { from: args.from, to: args.to, amount: args.amount, account, lang: lang as "es" | "pt" | "en" });
      } catch (err) {
        if (!(err instanceof ApiFailure) || err.code !== "via_dollars") return asToolError(err);
        finalDestination = args.to;
        q = await createQuote(deps, { from: args.from, to: "USDT", amount: args.amount, account, lang: lang as "es" | "pt" | "en" });
      }
      quotes.push(q);
      return {
        data: {
          status: finalDestination ? "pending_first_step" : "pending_confirmation",
          finalDestination,
          note: finalDestination ? "The card is ONLY the first conversion to USDT. After it confirms, refresh balances and prepare a fresh quote for the destination. Do not prepare the second card before that or promise a locked final amount. Nothing has moved." : "A quote card with a Confirm button is shown in the app; confirming opens the MiniPay confirmation. Nothing has moved.",
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

    async list_contacts() {
      return { data: { contacts: ctx.contacts.map((c) => ({ name: c.name, address: c.address, hasWallet: !!c.address, receive: c.receive })), note: "These are the phone's saved contacts. Use the exact saved name for prepare_send; never guess between similar names." } };
    },

    async prepare_send(args) {
      const matches = ctx.contacts.filter((c) => norm(c.name) === norm(args.recipient));
      if (matches.length > 1) throw new ToolUserError("More than one saved contact has that name. Ask the user to select the recipient in Send.", "bad_request");
      const contact = matches[0];
      if (contact && !contact.address) throw new ToolUserError(`Saved contact "${contact.name}" needs a wallet attached. In Send, pick them from MiniPay contacts before preparing the payment.`, "bad_request");
      const typed = /^0x[0-9a-fA-F]{40}$/.test(args.recipient) && ctx.userAddresses?.some((a) => a.toLowerCase() === args.recipient.toLowerCase());
      if (!contact && !typed) throw new ToolUserError(`No saved contact named "${args.recipient}". Use list_contacts and ask which saved name they mean, or ask them to type their recipient's 0x address.`, "bad_request");
      const recipient = (contact?.address ?? args.recipient).toLowerCase() as Address;
      if (recipient === account.toLowerCase() || /^0x0{40}$/.test(recipient)) throw new ToolUserError("Choose a recipient other than your own wallet or the zero address.", "bad_request");
      const to = args.destinationToken ?? contact?.receive ?? args.token;
      const amountIn = parseAmount(args.token, args.amount);
      try {
        const have = await deps.chain.readContract({ address: TOKENS[args.token].address, abi: erc20Abi, functionName: "balanceOf", args: [account] });
        if (amountIn > have) throw new ToolUserError("That amount exceeds the wallet balance. Read get_balances and use maximumSend for 'all', leaving the fee reserve.", "bad_request");
        await checkFeeReserve(deps, account, args.token, amountIn);
        const quote = args.token === to ? null : await createQuote(deps, { from: args.token, to, amount: args.amount, account, lang: lang as "es" | "pt" | "en" }, { recipient });
        const send = { id: randomUUID(), recipient, recipientName: contact?.name ?? recipient, from: args.token, to, amount: args.amount, quote };
        (ctx.sends ??= []).push(send);
        return { data: { status: "pending_review", recipient: send.recipientName, amount: args.amount, token: args.token, receive: to, youPay: fmtAmount(TOKENS[args.token].address, amountIn), recipientGets: fmtAmount(TOKENS[to].address, quote ? BigInt(quote.expectedOut) : amountIn), note: "A send card is shown. The user taps Review send, checks the recipient and amount, then confirms in MiniPay. Nothing has moved. Never prepare a conversion card instead of this send." }, card: { kind: "send", id: send.id } };
      } catch (err) { return asToolError(err); }
    },

    async prepare_scheduled_send(args) {
      const c = ctx.contacts.find((x) => norm(x.name) === norm(args.contact));
      if (!c?.address) {
        const names = ctx.contacts.map((x) => x.name).join(", ");
        throw new ToolUserError(names ? `No saved contact called "${args.contact}" with a wallet. Saved: ${names}.` : "The user has no saved contacts with a wallet yet; they can add one in Send.", "bad_request");
      }
      try {
        const spec = parseRule("send", { contact: c.address, contactName: c.name, amountUsdt: parseAmount("USDT", args.amountUsd).toString(), receive: args.receive ?? "USDT", dayOfMonth: args.dayOfMonth });
        return ruleResult(await draftRule(deps, account, lang, spec));
      } catch (err) {
        return asToolError(err);
      }
    },

    async prepare_payday_split(args) {
      try {
        const spec = parseRule("split", { percent: args.percent, to: args.to, minIncomingUsdt: parseAmount("USDT", args.minIncomingUsd).toString() });
        return ruleResult(await draftRule(deps, account, lang, spec));
      } catch (err) {
        return asToolError(err);
      }
    },

    async prepare_peso_guardian(args) {
      try {
        const spec = parseRule("guardian", { sym: args.currency, baseDollarPct: args.baseDollarPercent, bandPct: args.bandPoints ?? 5 });
        return ruleResult(await draftRule(deps, account, lang, spec));
      } catch (err) {
        return asToolError(err);
      }
    },

    async list_rules() {
      const { rules, runs } = await listRulesRes(deps, account);
      return { data: { rules: rules.map((r) => ({ id: r.ruleId, status: r.status, rule: r.description, nextRunAt: r.nextRunAt, stoppedReason: r.stoppedReason })), latestRuns: runs.slice(0, 5) } };
    },

    async get_limits() {
      // The only limits are the user's own: none on conversions they confirm in MiniPay, and the
      // ones they signed into ArbolitoGuard for automatic rules. Arbolito sets no cap of its own.
      const budget = deps.guard ? await readGuardV2Budget(deps.chain, deps.guard.address, account, TOKENS.USDT.address as Address).catch(() => null) : null;
      return {
        data: {
          conversions: "No limit from Arbolito on conversions the user confirms in MiniPay; only what the market can fill.",
          automaticRules:
            budget && budget.maxPerDay > 0n
              ? { perOperation: formatUsd(budget.maxPerTx), perDay: formatUsd(budget.maxPerDay), usedToday: formatUsd(budget.spentToday), setBy: "the user, onchain" }
              : "Off. The user picks their own limits when turning on automatic rules (Settings → Limits & security).",
          note: "Autonomy limits are set in the app, never in chat.",
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
          can: ["check balances", "quote and convert pesos, reais and dollars", "deposit and cash-out links via Ripio", "show receipts after a conversion", "list saved contacts and prepare sends for review in MiniPay"],
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
  const ctx: ChatContext = {
    contacts: req.contacts ?? [], rules: [], sends: [],
    userAddresses: [...history.filter((m) => m.role === "user").map((m) => typeof m.content === "string" ? m.content : ""), userText].flatMap((s) => s.match(/0x[0-9a-fA-F]{40}\b/g) ?? []),
  };
  let result;
  try {
    result = await runAgentTurn({
      history,
      userText,
      // Reply in the language the user wrote in (the app language is the fallback when it is unclear).
      language: detectLanguage(userText, req.lang),
      tools: buildChatHandlers(deps, user, account, req.lang, quotes, ctx),
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
  return { transcript, reply: result.text, quotes, rules: ctx.rules, sends: ctx.sends ?? [] };
}
