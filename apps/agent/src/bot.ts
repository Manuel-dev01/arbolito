import { Bot, type Context } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { sequentialize } from "@grammyjs/runner";
import { loadEnv } from "@arbolito/config";
import { log } from "@arbolito/chain";
import { detectLanguage, runAgentTurn, transcribe, type AgentCard } from "@arbolito/llm";
import type { QuoteErrorCopy } from "./api";
import {
  LINK_NEW,
  LINK_WHAT,
  isCardPayload,
  parseCardData,
  parseRetryData,
  renderAlreadyLinked,
  renderAlternatives,
  renderNeedLink,
  renderNoMarket,
  renderWelcome,
  type CardRequest,
  type Rendered,
} from "./card";
import { checkAccess, parseAllowlist } from "./access";
import { parseSym, type Sym } from "./contract";
import { CardFlow } from "./flow";
import { copy, esc, langFromTelegram, t, type Lang } from "./i18n";
import { Linker } from "./linking";
import { getServices, type Services } from "./services";
import { buildHandlers } from "./tools";
import { appendHistory, getPending, loadHistory, transitionPending, upsertUser, type User } from "./store";

type Ctx = Context & { user: User; lang: Lang };

const HTML = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
const send = (ctx: Ctx, r: Rendered) => ctx.reply(r.text, { ...HTML, reply_markup: r.keyboard });

export interface Arbolito {
  bot: Bot<Ctx>;
  flow: CardFlow;
  linker: Linker;
}

/** Parses "/quote wBRL wARS 200" arguments; null if malformed. */
export function parseQuoteArgs(match: string): { from: Sym; to: Sym; amount: string } | null {
  const [a, b, amount, ...rest] = match.trim().split(/\s+/);
  if (rest.length || !a || !b || !amount) return null;
  const from = parseSym(a);
  const to = parseSym(b);
  const normalized = amount.replace(",", ".");
  if (!from || !to || from === to || !/^\d{1,30}(\.\d{1,18})?$/.test(normalized) || !/[1-9]/.test(normalized)) return null;
  return { from, to, amount: normalized };
}

export function createBot(token: string): Arbolito {
  const s = getServices();
  const bot = new Bot<Ctx>(token);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 2, maxDelaySeconds: 10 }));
  const flow = new CardFlow({ db: s.db, api: bot.api, client: s.miniapp, links: s.links, baseUrl: s.baseUrl });
  const linker = new Linker({ db: s.db, api: bot.api, links: s.links });

  async function quoteError(ctx: Ctx, error: QuoteErrorCopy, req: { from: Sym; to: Sym; amount: string }, lang: Lang) {
    if (error === "noMarket") return send(ctx, renderNoMarket(req.from, req.to, req.amount, lang));
    return ctx.reply(t(error, lang), HTML);
  }

  async function postConvert(ctx: Ctx, req: { from: Sym; to: Sym; amount: string }, lang: Lang) {
    await ctx.replyWithChatAction("typing");
    const r = await flow.createConvert(ctx.user, lang, { kind: "convert", ...req });
    if (r.ok) return flow.post(ctx.chat!.id, r.pendingId);
    return quoteError(ctx, r.error, req, lang);
  }

  /** Same pair and amount (or the same send) as an old card, as a fresh card. */
  async function requote(ctx: Ctx, request: CardRequest, lang: Lang) {
    if (request.kind === "convert") return postConvert(ctx, request, lang);
    await ctx.replyWithChatAction("typing");
    const r = await flow.createSend(ctx.user, lang, request);
    if (r.ok) return flow.post(ctx.chat!.id, r.pendingId);
    return quoteError(ctx, r.error, { from: request.token, to: request.receive ?? request.token, amount: request.amount }, lang);
  }

  async function renderAgentCards(ctx: Ctx, cards: AgentCard[], lang: Lang) {
    let linkShown = false;
    for (const card of cards) {
      if (card.kind === "convert" || card.kind === "send") await flow.post(ctx.chat!.id, card.id);
      else if (card.kind === "link" && !linkShown) {
        linkShown = true;
        await send(ctx, renderNeedLink(lang));
      } else if (card.kind === "no_market") {
        const d = card.data as { from: string; to: string; amount: string };
        const from = parseSym(d.from);
        const to = parseSym(d.to);
        if (from && to) await send(ctx, renderNoMarket(from, to, d.amount, lang));
      }
    }
  }

  /** One conversational turn: LLM with tools, reply as plain text, then any cards. */
  async function handleText(ctx: Ctx, text: string, lang: Lang) {
    const env = loadEnv();
    const history = await loadHistory(s.db, ctx.user.id);
    const result = await runAgentTurn({ history, userText: text, language: lang, tools: buildHandlers(s, flow, ctx.user), model: env.AGENT_MODEL });
    await appendHistory(s.db, ctx.user.id, result.messages);
    for (const tc of result.toolCalls) if (!tc.ok) log(`[agent] tool ${tc.name} failed: ${tc.error ?? ""}`);
    if (result.text) await ctx.reply(result.text); // plain text: model output is never parsed as HTML
    await renderAgentCards(ctx, result.cards, lang);
  }

  async function connect(ctx: Ctx, force: boolean) {
    if (ctx.user.walletAddress && !force) return send(ctx, renderAlreadyLinked(ctx.lang, ctx.user.walletAddress));
    await linker.start(ctx.chat!.id, ctx.user, ctx.lang);
  }

  // One update at a time per chat: no two actions from the same user can race.
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

  // Private chats only. Beta gate before anything is stored. Then attach the user and language.
  const allowlist = parseAllowlist(loadEnv().TELEGRAM_ALLOWED_USERS);
  const pinned = new Set<number>();
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from || ctx.from.is_bot) return;
    const access = checkAccess(allowlist, ctx.from);
    if (access === "denied") {
      await ctx.reply(t("privateBeta", langFromTelegram(ctx.from.language_code))).catch(() => {});
      return;
    }
    if (access === "username" && !pinned.has(ctx.from.id)) {
      pinned.add(ctx.from.id);
      log(`[beta] @${ctx.from.username} allowed by username; numeric id ${ctx.from.id} (add it to TELEGRAM_ALLOWED_USERS)`);
    }
    ctx.user = await upsertUser(s.db, ctx.from);
    ctx.lang = (ctx.user.language as Lang) ?? "es";
    await next();
  });

  bot.command("start", (ctx) => send(ctx, renderWelcome(ctx.lang, ctx.from?.first_name ?? null, ctx.user.walletAddress)));
  bot.command(["conectar", "connect", "link"], (ctx) => connect(ctx, false));

  // Deterministic quote, no LLM: /quote wBRL wARS 200
  bot.command("quote", async (ctx) => {
    const req = parseQuoteArgs(ctx.match ?? "");
    if (!req) return ctx.reply(t("quoteUsage", ctx.lang), HTML);
    await postConvert(ctx, req, ctx.lang);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    await ctx.replyWithChatAction("typing");
    await handleText(ctx, ctx.message.text, ctx.lang);
  });

  // Voice notes: transcribe (language auto-detected), echo what was understood, reply in that language.
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    await ctx.replyWithChatAction("typing");
    const file = await ctx.getFile();
    if (!file.file_path) return ctx.reply(t("error", ctx.lang), HTML);
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return ctx.reply(t("error", ctx.lang), HTML);
    const audio = new Uint8Array(await res.arrayBuffer());
    const { text } = await transcribe(audio, { filename: "voice.ogg", mimeType: ctx.message.voice ? "audio/ogg" : (ctx.message.audio?.mime_type ?? "audio/mpeg") });
    const transcript = text.trim();
    if (!transcript) return ctx.reply(t("error", ctx.lang), HTML);
    const spoken = detectLanguage(transcript, ctx.lang);
    await ctx.reply(copy.voiceEcho(spoken, esc(transcript)), HTML);
    await handleText(ctx, transcript, spoken);
  });

  bot.callbackQuery(LINK_NEW, async (ctx) => {
    await ctx.answerCallbackQuery();
    await connect(ctx, true);
  });

  bot.callbackQuery(LINK_WHAT, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(t("whatIsMiniPay", ctx.lang), HTML);
  });

  // Card buttons. State changes are compare-and-set, so a double tap can't act twice.
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const retry = parseRetryData(data);
    if (retry) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
      return postConvert(ctx, retry, ctx.lang);
    }

    const parsed = parseCardData(data);
    if (!parsed) return ctx.answerCallbackQuery();
    const card = await getPending(s.db, parsed.id, ctx.user.id);
    if (!card) return ctx.answerCallbackQuery({ text: t("notFound", ctx.lang) });

    // Cards from before the MiniPay pivot (or an old Confirm button): retire them.
    if (parsed.op === "c" || !isCardPayload(card.payload)) {
      await transitionPending(s.db, card.id, "pending", "expired");
      await ctx.answerCallbackQuery({ text: t("expiredToast", ctx.lang) });
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});
      return;
    }
    const payload = card.payload;

    if (parsed.op === "rq") {
      await ctx.answerCallbackQuery();
      return requote(ctx, payload.request, payload.lang);
    }

    if (parsed.op === "alt") {
      const out = await flow.touch(card);
      if (out.kind !== "live") return ctx.answerCallbackQuery({ text: t("expiredToast", payload.lang) });
      await ctx.answerCallbackQuery();
      if (out.payload.quote?.alternatives.length) await ctx.reply(renderAlternatives(out.payload.quote, payload.lang), HTML);
      return;
    }

    // Cancel
    const out = await flow.cancel(card);
    if (out.kind === "inMiniPay") return ctx.answerCallbackQuery({ text: t("alreadyInMiniPay", payload.lang) });
    if (out.kind === "expired") return ctx.answerCallbackQuery({ text: t("expiredToast", payload.lang) });
    return ctx.answerCallbackQuery();
  });

  bot.catch((err) => {
    log(`[bot] update ${err.ctx.update.update_id} failed: ${(err.error as Error)?.message ?? String(err.error)}`);
    const ctx = err.ctx as Ctx;
    void ctx.reply(t("error", ctx.lang ?? "es"), HTML).catch(() => {});
  });

  return { bot, flow, linker };
}
