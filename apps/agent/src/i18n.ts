/**
 * User-facing copy (design/Telegram Chat.dc.html). es-AR uses "vos", pt-BR uses "você". Keep
 * crypto jargon out. Emoji: only ⏱ (countdown), 🎙️ (voice) and ✓ (done).
 *
 * Strings here are Telegram HTML. Static strings contain no user data. Template functions take
 * values that the caller has ALREADY escaped (see `esc`) or formatted by money.ts.
 */
export type Lang = "es" | "pt" | "en";

export const LANGS: readonly Lang[] = ["es", "pt", "en"];

export function langFromTelegram(code: string | undefined): Lang {
  const c = (code ?? "").toLowerCase();
  if (c.startsWith("pt")) return "pt";
  if (c.startsWith("en")) return "en";
  return "es";
}

/** Escapes text for Telegram's HTML parse mode (also safe inside attribute values). */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const STRINGS = {
  quoteUsage: {
    es: "Uso: <code>/quote DE A MONTO</code>, por ejemplo <code>/quote wBRL wARS 200</code>.\nMonedas: wARS, wBRL, USDT, USAT, USDC.",
    pt: "Uso: <code>/quote DE PARA VALOR</code>, por exemplo <code>/quote wBRL wARS 200</code>.\nMoedas: wARS, wBRL, USDT, USAT, USDC.",
    en: "Usage: <code>/quote FROM TO AMOUNT</code>, e.g. <code>/quote wBRL wARS 200</code>.\nCurrencies: wARS, wBRL, USDT, USAT, USDC.",
  },
  privateBeta: {
    es: "Arbolito está en beta privada por ahora. Pronto abrimos para todos.",
    pt: "O Arbolito está em beta privado por enquanto. Em breve abrimos para todos.",
    en: "Arbolito is in private beta for now. We open to everyone soon.",
  },
  rateLimited: {
    es: "Estás pidiendo muchas cotizaciones seguidas. Esperá un minuto y probá de nuevo. <b>No se movió plata.</b>",
    pt: "Você pediu muitas cotações seguidas. Espere um minuto e tente de novo. <b>Nenhum dinheiro foi movido.</b>",
    en: "That's a lot of quotes in a row. Wait a minute and try again. <b>No money moved.</b>",
  },
  quoteBad: {
    es: "No pude cotizar ese monto. Revisá el monto y las monedas. <b>No se movió plata.</b>",
    pt: "Não consegui cotar esse valor. Confira o valor e as moedas. <b>Nenhum dinheiro foi movido.</b>",
    en: "I couldn't quote that amount. Check the amount and the currencies. <b>No money moved.</b>",
  },
  error: {
    es: "Algo salió mal de mi lado. <b>No se movió plata.</b> Probá de nuevo en un momento.",
    pt: "Algo deu errado do meu lado. <b>Nenhum dinheiro foi movido.</b> Tente de novo em instantes.",
    en: "Something went wrong on my side. <b>No money moved.</b> Please try again in a moment.",
  },
  notFound: { es: "No encontré esa operación.", pt: "Não encontrei essa operação.", en: "I couldn't find that action." },
  expiredToast: { es: "Esta cotización venció.", pt: "Esta cotação venceu.", en: "This quote expired." },
  alreadyInMiniPay: {
    es: "Ya lo estás confirmando en MiniPay.",
    pt: "Você já está confirmando no MiniPay.",
    en: "You're already confirming it in MiniPay.",
  },
  needLink: {
    es: "Para eso necesito tu <b>MiniPay</b>. Se conecta una sola vez y tu plata siempre se confirma ahí.",
    pt: "Para isso preciso do seu <b>MiniPay</b>. Ele se conecta uma vez só e seu dinheiro sempre é confirmado lá.",
    en: "For that I need your <b>MiniPay</b>. You connect it once, and your money is always confirmed there.",
  },
  whatIsMiniPay: {
    es: "MiniPay es una billetera de dólares digitales de Opera, en la red Celo. Arbolito funciona adentro de MiniPay: ahí confirmás cada movimiento con tu propia billetera. Desde Telegram pedís cotizaciones, mandás audios y recibís tus comprobantes.",
    pt: "O MiniPay é uma carteira de dólares digitais da Opera, na rede Celo. O Arbolito funciona dentro do MiniPay: lá você confirma cada movimento com a sua própria carteira. Pelo Telegram você pede cotações, manda áudios e recebe seus comprovantes.",
    en: "MiniPay is a digital-dollar wallet by Opera, on the Celo network. Arbolito runs inside MiniPay: you confirm every move there, with your own wallet. In Telegram you ask for quotes, send voice notes and get your receipts.",
  },
  alternatives: { es: "Alternativas", pt: "Alternativas", en: "Alternatives" },
  sendNeedsAmount: {
    es: "No pude armar ese envío. Revisá el monto y la moneda.",
    pt: "Não consegui montar esse envio. Confira o valor e a moeda.",
    en: "I couldn't set up that send. Check the amount and the currency.",
  },
  // Buttons
  btnConfirm: { es: "Confirmar en MiniPay ↗", pt: "Confirmar no MiniPay ↗", en: "Confirm in MiniPay ↗" },
  btnAlternatives: { es: "Ver alternativas", pt: "Ver alternativas", en: "See alternatives" },
  btnCancel: { es: "Cancelar", pt: "Cancelar", en: "Cancel" },
  btnRequote: { es: "Pedir nueva cotización", pt: "Pedir nova cotação", en: "Get a new quote" },
  btnQuoteAgain: { es: "Volver a cotizar", pt: "Cotar de novo", en: "Quote again" },
  btnRetry: { es: "Probar de nuevo", pt: "Tentar de novo", en: "Try again" },
  btnConnect: { es: "Conectá tu MiniPay", pt: "Conecte seu MiniPay", en: "Connect your MiniPay" },
  btnConnectAnother: { es: "Conectar otro MiniPay", pt: "Conectar outro MiniPay", en: "Connect another MiniPay" },
  btnConnectUrl: { es: "Conectar en MiniPay ↗", pt: "Conectar no MiniPay ↗", en: "Connect in MiniPay ↗" },
  btnWhatIsMiniPay: { es: "¿Qué es MiniPay?", pt: "O que é o MiniPay?", en: "What is MiniPay?" },
  btnNewCode: { es: "Pedir otro código", pt: "Pedir outro código", en: "Get a new code" },
  btnReceipt: { es: "Ver comprobante ↗", pt: "Ver comprovante ↗", en: "View receipt ↗" },
  btnShare: { es: "Compartir", pt: "Compartilhar", en: "Share" },
} as const satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

export const t = (key: StringKey, lang: Lang): string => STRINGS[key][lang];

type L<A extends unknown[]> = Record<Lang, (...a: A) => string>;
const pick = <A extends unknown[]>(table: L<A>, lang: Lang, ...a: A) => table[lang](...a);

/** Template copy. Every string argument must already be escaped or formatted. */
export const copy = {
  welcome: (lang: Lang, name: string | null) =>
    pick<[string]>(
      {
        es: (n) => `Hola${n}. Soy <b>Arbolito</b>, tu cambista: cambio y mando pesos, reales y dólares al mejor precio del momento, y cada operación tiene su comprobante.`,
        pt: (n) => `Oi${n}. Eu sou o <b>Arbolito</b>, seu cambista: troco e envio reais, pesos e dólares pelo melhor preço do momento, e cada operação tem seu comprovante.`,
        en: (n) => `Hi${n}. I'm <b>Arbolito</b>, your money-changer: I convert and send pesos, reais and dollars at the best rate right now, and every trade comes with a receipt.`,
      },
      lang,
      name ? `, ${name}` : "",
    ),
  welcomeUnlinked: {
    es: "Para mover tu plata necesito tu <b>MiniPay</b>. Se conecta una sola vez y tu plata siempre se confirma ahí.",
    pt: "Para mover seu dinheiro preciso do seu <b>MiniPay</b>. Ele se conecta uma vez só e seu dinheiro sempre é confirmado lá.",
    en: "To move your money I need your <b>MiniPay</b>. You connect it once, and your money is always confirmed there.",
  } satisfies Record<Lang, string>,
  welcomeLinked: (lang: Lang, wallet: string) =>
    pick<[string]>(
      {
        es: (w) => `Tu MiniPay <b>${w}</b> ya está conectado. Probá escribirme <i>pasá 100 dólares a pesos</i>, mandame un audio o usá <code>/quote wBRL wARS 200</code>.`,
        pt: (w) => `Seu MiniPay <b>${w}</b> já está conectado. Tente me escrever <i>troca 100 dólares por reais</i>, me mande um áudio ou use <code>/quote wBRL wARS 200</code>.`,
        en: (w) => `Your MiniPay <b>${w}</b> is connected. Try writing <i>change 100 dollars to pesos</i>, send me a voice note or use <code>/quote wBRL wARS 200</code>.`,
      },
      lang,
      wallet,
    ),

  // ── Linking ──
  linkCode: (lang: Lang, code: string) =>
    pick<[string]>(
      {
        es: (c) => `Tu código: <code>${c}</code>\nEn MiniPay abrí Arbolito → <b>Ajustes → Telegram</b> y escribilo ahí. Vence en 10 min.`,
        pt: (c) => `Seu código: <code>${c}</code>\nNo MiniPay, abra o Arbolito → <b>Ajustes → Telegram</b> e digite lá. Expira em 10 min.`,
        en: (c) => `Your code: <code>${c}</code>\nIn MiniPay, open Arbolito → <b>Settings → Telegram</b> and type it there. Expires in 10 min.`,
      },
      lang,
      code,
    ),
  linkCodeUsed: (lang: Lang, code: string) =>
    pick<[string]>({ es: (c) => `Tu código: <code>${c}</code>\n✓ Usado.`, pt: (c) => `Seu código: <code>${c}</code>\n✓ Usado.`, en: (c) => `Your code: <code>${c}</code>\n✓ Used.` }, lang, code),
  linkCodeExpired: (lang: Lang, code: string) =>
    pick<[string]>(
      {
        es: (c) => `Tu código: <s>${c}</s>\nEste código venció. Pedí otro cuando quieras.`,
        pt: (c) => `Seu código: <s>${c}</s>\nEste código expirou. Peça outro quando quiser.`,
        en: (c) => `Your code: <s>${c}</s>\nThis code expired. Get a new one whenever you like.`,
      },
      lang,
      code,
    ),
  linked: (lang: Lang, wallet: string) =>
    pick<[string]>(
      {
        es: (w) => `<b>Listo, conectado.</b> ✓\nTelegram ya usa tu MiniPay <b>${w}</b>.\n\nProbá escribirme <i>pasá 100 dólares a pesos</i> o mandame un audio.`,
        pt: (w) => `<b>Pronto, conectado.</b> ✓\nO Telegram já usa seu MiniPay <b>${w}</b>.\n\nTente me escrever <i>troca 100 dólares por reais</i> ou me mande um áudio.`,
        en: (w) => `<b>Done, connected.</b> ✓\nTelegram now uses your MiniPay <b>${w}</b>.\n\nTry writing <i>change 100 dollars to pesos</i> or send me a voice note.`,
      },
      lang,
      wallet,
    ),
  alreadyLinked: (lang: Lang, wallet: string) =>
    pick<[string]>(
      {
        es: (w) => `Tu MiniPay <b>${w}</b> ya está conectado.`,
        pt: (w) => `Seu MiniPay <b>${w}</b> já está conectado.`,
        en: (w) => `Your MiniPay <b>${w}</b> is already connected.`,
      },
      lang,
      wallet,
    ),

  // ── Voice ──
  voiceEcho: (lang: Lang, transcript: string) =>
    pick<[string]>({ es: (x) => `🎙️ Entendí: <i>${x}</i>`, pt: (x) => `🎙️ Entendi: <i>${x}</i>`, en: (x) => `🎙️ I heard: <i>${x}</i>` }, lang, transcript),

  // ── Quote card (ledger, 4a) ──
  youGet: { es: "Recibís", pt: "Você recebe", en: "You get" } satisfies Record<Lang, string>,
  forWord: { es: "por", pt: "por", en: "for" } satisfies Record<Lang, string>,
  rateLabel: { es: "Cotización", pt: "Cotação", en: "Rate" } satisfies Record<Lang, string>,
  vsOfficial: { es: "vs oficial", pt: "vs oficial", en: "vs official" } satisfies Record<Lang, string>,
  more: { es: "más", pt: "a mais", en: "more" } satisfies Record<Lang, string>,
  routeLabel: { es: "Ruta", pt: "Rota", en: "Route" } satisfies Record<Lang, string>,
  route: (lang: Lang, steps: number) =>
    steps <= 1
      ? { es: "directo, por el mejor mercado", pt: "direto, pelo melhor mercado", en: "direct, best market" }[lang]
      : { es: `${steps} pasos, por el mejor mercado`, pt: `${steps} passos, pelo melhor mercado`, en: `${steps} steps, best market` }[lang],
  minimum: { es: "Mínimo garantizado", pt: "Mínimo garantido", en: "Guaranteed minimum" } satisfies Record<Lang, string>,
  expiresIn: (lang: Lang, seconds: number) => {
    const span = seconds >= 120 ? `${Math.floor(seconds / 60)} min` : `${seconds} s`;
    return { es: `⏱ Vence en <b>${span}</b>.`, pt: `⏱ Expira em <b>${span}</b>.`, en: `⏱ Expires in <b>${span}</b>.` }[lang];
  },
  expiresInShort: (lang: Lang, seconds: number) => {
    const span = seconds >= 120 ? `${Math.floor(seconds / 60)} min` : `${seconds} s`;
    return { es: `⏱ Vence en <b>${span}</b>`, pt: `⏱ Expira em <b>${span}</b>`, en: `⏱ Expires in <b>${span}</b>` }[lang];
  },

  // ── Send card (compact, 4b) ──
  recipientGets: (lang: Lang, who: string, amount: string) =>
    ({ es: `${who} recibe ${amount}`, pt: `${who} recebe ${amount}`, en: `${who} gets ${amount}` })[lang],
  convertSteps: (lang: Lang, steps: number) =>
    steps <= 1
      ? { es: "Cambiamos directo por el mejor mercado.", pt: "Trocamos direto pelo melhor mercado.", en: "We convert directly, best market." }[lang]
      : { es: `Cambiamos en ${steps} pasos por el mejor mercado.`, pt: `Trocamos em ${steps} passos pelo melhor mercado.`, en: `We convert in ${steps} steps, best market.` }[lang],
  youSend: (lang: Lang, amount: string, who: string) =>
    ({ es: `Mandás ${amount} a ${who}`, pt: `Você envia ${amount} para ${who}`, en: `You send ${amount} to ${who}` })[lang],

  // ── State changes (the bot edits the card) ──
  expired: {
    es: "<b>Esta cotización venció. No se movió plata.</b>",
    pt: "<b>Esta cotação venceu. Nenhum dinheiro foi movido.</b>",
    en: "<b>This quote expired. No money moved.</b>",
  } satisfies Record<Lang, string>,
  /** Expired after the mini app prepared the calls: the wallet may still send, so no "no money moved". */
  expiredPrepared: {
    es: "<b>Esta cotización venció.</b> Si ya confirmaste en MiniPay, te aviso acá.",
    pt: "<b>Esta cotação venceu.</b> Se você já confirmou no MiniPay, eu aviso aqui.",
    en: "<b>This quote expired.</b> If you already confirmed in MiniPay, I'll let you know here.",
  } satisfies Record<Lang, string>,
  cancelledTelegram: { es: "Cancelado. <b>No se movió plata.</b>", pt: "Cancelado. <b>Nenhum dinheiro foi movido.</b>", en: "Cancelled. <b>No money moved.</b>" } satisfies Record<Lang, string>,
  cancelledMiniPay: {
    es: "Cancelaste en MiniPay. <b>No se movió plata.</b>",
    pt: "Você cancelou no MiniPay. <b>Nenhum dinheiro foi movido.</b>",
    en: "You cancelled in MiniPay. <b>No money moved.</b>",
  } satisfies Record<Lang, string>,
  processing: (lang: Lang, kind: "convert" | "send") =>
    kind === "send"
      ? { es: "✓ Confirmado en MiniPay. Enviando…", pt: "✓ Confirmado no MiniPay. Enviando…", en: "✓ Confirmed in MiniPay. Sending…" }[lang]
      : { es: "✓ Confirmado en MiniPay. Cambiando…", pt: "✓ Confirmado no MiniPay. Trocando…", en: "✓ Confirmed in MiniPay. Converting…" }[lang],
  doneLine: { es: "✓ Listo.", pt: "✓ Pronto.", en: "✓ Done." } satisfies Record<Lang, string>,
  failed: (lang: Lang, amountIn: string) =>
    ({
      es: `<b>No pudimos hacer el cambio. No se movió plata.</b>\nTus ${amountIn} siguen en tu MiniPay.`,
      pt: `<b>Não conseguimos fazer a troca. Nenhum dinheiro foi movido.</b>\nSeus ${amountIn} continuam no seu MiniPay.`,
      en: `<b>We couldn't make the conversion. No money moved.</b>\nYour ${amountIn} is still in your MiniPay.`,
    })[lang],
  failedPriceChanged: {
    es: "El precio cayó debajo del mínimo garantizado, así que lo frenamos.",
    pt: "O preço caiu abaixo do mínimo garantido, então paramos.",
    en: "The price fell below the guaranteed minimum, so we stopped it.",
  } satisfies Record<Lang, string>,

  // ── Results (new messages) ──
  done: (lang: Lang, got: string, paid: string) =>
    ({
      es: `<b>Listo.</b> Recibiste <b>${got}</b> por ${paid}.`,
      pt: `<b>Pronto.</b> Você recebeu <b>${got}</b> por ${paid}.`,
      en: `<b>Done.</b> You got <b>${got}</b> for ${paid}.`,
    })[lang],
  doneSend: (lang: Lang, who: string, got: string) =>
    ({ es: `<b>Listo.</b> ${who} recibió <b>${got}</b>.`, pt: `<b>Pronto.</b> ${who} recebeu <b>${got}</b>.`, en: `<b>Done.</b> ${who} got <b>${got}</b>.` })[lang],
  savings: (lang: Lang, pct: string, delta: string | null) =>
    ({
      es: `${pct} vs oficial${delta ? ` · ${delta} más que al oficial` : ""}.`,
      pt: `${pct} vs oficial${delta ? ` · ${delta} a mais que no oficial` : ""}.`,
      en: `${pct} vs official${delta ? ` · ${delta} more than at the official rate` : ""}.`,
    })[lang],
  receiptLine: (lang: Lang, link: string) =>
    ({
      es: `Comprobante ${link}\nCualquiera puede verificarlo.`,
      pt: `Comprovante ${link}\nQualquer pessoa pode verificar.`,
      en: `Receipt ${link}\nAnyone can verify it.`,
    })[lang],

  // ── No market (4.7) ──
  noMarket: (lang: Lang, pair: string) =>
    ({
      es: `Ahora no hay mercado para <b>${pair}</b>. Pasa unos minutos cuando hay mucho movimiento. <b>No se movió plata.</b>`,
      pt: `Agora não há mercado para <b>${pair}</b>. Isso acontece por alguns minutos quando há muito movimento. <b>Nenhum dinheiro foi movido.</b>`,
      en: `There's no market for <b>${pair}</b> right now. It happens for a few minutes when things are busy. <b>No money moved.</b>`,
    })[lang],
};
