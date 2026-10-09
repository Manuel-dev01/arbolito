import { Bot, type Context } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { sequentialize } from "@grammyjs/runner";
import { loadEnv } from "@arbolito/config";
import { log } from "@arbolito/chain";
import { runAgentTurn, transcribe, type AgentCard } from "@arbolito/llm";
import { cardKeyboard, parseCardData, renderAlternatives, renderCard } from "./card";
import { t, type Lang } from "./i18n";
import { NoRouteError, quote } from "./quotes";
import { deserializeRoute, serializeRoute, type Json } from "./serde";
import { getServices, type Services } from "./services";
import { QUOTE_TTL_MS, buildHandlers } from "./tools";
import { appendHistory, createPending, getPending, loadHistory, transitionPending, upsertUser, type PendingAction, type User } from "./store";

type Ctx = Context & { user: User; lang: Lang };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const secondsLeft = (p: PendingAction) => Math.max(0, Math.round((p.expiresAt.getTime() - Date.now()) / 1000));

/** HTML for a pending action's card. */
function renderPending(p: PendingAction, lang: Lang): { text: string; hasAlternatives: boolean } {
  const payload = p.payload as Record<string, Json>;
  const references = (payload.references ?? []) as never;
  if (p.kind === "convert") {
    const route = deserializeRoute(payload.route!);
    const alts = (payload.alternatives ?? []) as Json[];
    return { text: renderCard({ route, references, lang, ttlSeconds: secondsLeft(p) }), hasAlternatives: alts.length > 0 };
  }
  // send
  const who = esc(String(payload.contactName ?? payload.to));
  const lines = [`➡️ <b>${who}</b>`, `${esc(String(payload.amount))} ${esc(String(payload.token))}`];
  if (payload.route) lines.push(renderCard({ route: deserializeRoute(payload.route), references, lang, ttlSeconds: secondsLeft(p) }));
  else lines.push(`${t("expiresIn", lang)} ${secondsLeft(p)}s`);
  return { text: lines.join("\n"), hasAlternatives: false };
}

async function sendCard(ctx: Ctx, s: Services, card: AgentCard) {
  if (card.kind !== "convert" && card.kind !== "send") return;
  const pending = await getPending(s.db, card.id, ctx.user.id);
  if (!pending) return;
  const { text, hasAlternatives } = renderPending(pending, ctx.lang);
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: cardKeyboard(pending.id, ctx.lang, hasAlternatives) });
}

/** One conversational turn: LLM with tools, reply as plain text, then any cards. */
async function handleText(ctx: Ctx, s: Services, text: string) {
  const env = loadEnv();
  const history = await loadHistory(s.db, ctx.user.id);
  const result = await runAgentTurn({
    history,
    userText: text,
    language: ctx.lang,
    tools: buildHandlers(s, ctx.user),
    model: env.AGENT_MODEL,
  });
  await appendHistory(s.db, ctx.user.id, result.messages);
  for (const tc of result.toolCalls) if (!tc.ok) log(`[agent] tool ${tc.name} failed: ${tc.error ?? ""}`);
  if (result.text) await ctx.reply(result.text); // plain text: never parse model output as HTML
  for (const card of result.cards) await sendCard(ctx, s, card);
}

export function createBot(token: string): Bot<Ctx> {
  const s = getServices();
  const bot = new Bot<Ctx>(token);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 2, maxDelaySeconds: 10 }));

  // One update at a time per chat: no two actions from the same user can race the caps.
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()));

  // Private chats only (group "vaquinha" mode is P2). Attach the user and their language.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" || !ctx.from || ctx.from.is_bot) return;
    ctx.user = await upsertUser(s.db, ctx.from);
    ctx.lang = (ctx.user.language as Lang) ?? "es";
    await next();
  });

  bot.command("start", (ctx) => ctx.reply(t("welcome", ctx.lang), { parse_mode: "HTML" }));

  // Deterministic quote, no LLM: /quote wBRL wARS 200
  bot.command("quote", async (ctx) => {
    const [from, to, amount] = (ctx.match ?? "").trim().split(/\s+/);
    if (!from || !to || !amount || !/^\d+(\.\d+)?$/.test(amount)) return ctx.reply(t("quoteUsage", ctx.lang), { parse_mode: "HTML" });
    await ctx.replyWithChatAction("typing");
    try {
      const q = await quote(s, from, to, amount, ctx.user.walletAddress);
      const pending = await createPending(
        s.db,
        ctx.user.id,
        "convert",
        { route: serializeRoute(q.route), alternatives: q.alternatives.slice(0, 5).map(serializeRoute), references: q.references as never },
        QUOTE_TTL_MS,
      );
      await sendCard(ctx, s, { kind: "convert", id: pending.id });
    } catch (err) {
      if (err instanceof NoRouteError) return ctx.reply(t("noRoute", ctx.lang));
      throw err;
    }
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    await ctx.replyWithChatAction("typing");
    await handleText(ctx, s, ctx.message.text);
  });

  // Voice notes: transcribe with Groq Whisper, echo the transcript, then handle like text.
  bot.on(["message:voice", "message:audio"], async (ctx) => {
    await ctx.replyWithChatAction("typing");
    const file = await ctx.getFile();
    if (!file.file_path) return ctx.reply(t("error", ctx.lang));
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return ctx.reply(t("error", ctx.lang));
    const audio = new Uint8Array(await res.arrayBuffer());
    const { text } = await transcribe(audio, { filename: "voice.ogg", mimeType: ctx.message.voice ? "audio/ogg" : (ctx.message.audio?.mime_type ?? "audio/mpeg"), language: ctx.lang });
    if (!text.trim()) return ctx.reply(t("error", ctx.lang));
    await ctx.reply(`🎙️ “${text.trim()}”`);
    await handleText(ctx, s, text);
  });

  // Card buttons. State changes are atomic, so a double tap can't act twice.
  bot.on("callback_query:data", async (ctx) => {
    const parsed = parseCardData(ctx.callbackQuery.data);
    if (!parsed) return ctx.answerCallbackQuery();
    const pending = await getPending(s.db, parsed.id, ctx.user.id);
    if (!pending) return ctx.answerCallbackQuery({ text: t("notFound", ctx.lang) });

    if (parsed.op === "alt") {
      const payload = pending.payload as Record<string, Json>;
      const alts = ((payload.alternatives ?? []) as Json[]).map(deserializeRoute);
      await ctx.answerCallbackQuery();
      if (alts.length) await ctx.reply(renderAlternatives(deserializeRoute(payload.route!), alts, ctx.lang), { parse_mode: "HTML" });
      return;
    }

    if (parsed.op === "x") {
      const ok = await transitionPending(s.db, pending.id, "pending", "cancelled");
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      if (ok) await ctx.reply(t("cancelled", ctx.lang));
      return;
    }

    // Confirm
    if (pending.expiresAt.getTime() < Date.now()) {
      await transitionPending(s.db, pending.id, "pending", "expired");
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      return ctx.reply(t("expired", ctx.lang));
    }
    await ctx.answerCallbackQuery();
    // Execution through the user's smart account + session key + guard lands in the next block.
    // Until then nothing moves; say so plainly and leave the card untouched.
    return ctx.reply(t("walletNotReady", ctx.lang));
  });

  bot.catch((err) => {
    log(`[bot] update ${err.ctx.update.update_id} failed: ${(err.error as Error)?.message ?? String(err.error)}`);
    const ctx = err.ctx as Ctx;
    void ctx.reply(t("error", ctx.lang ?? "es")).catch(() => {});
  });

  return bot;
}

