/** User-facing copy. es-AR uses "vos", pt-BR uses "você". Keep crypto jargon out. */
export type Lang = "es" | "pt" | "en";

export const LANGS: readonly Lang[] = ["es", "pt", "en"];

export function langFromTelegram(code: string | undefined): Lang {
  const c = (code ?? "").toLowerCase();
  if (c.startsWith("pt")) return "pt";
  if (c.startsWith("en")) return "en";
  return "es";
}

const STRINGS = {
  welcome: {
    es: "¡Hola! Soy Arbolito 🌳, tu cambista. Te ayudo a pasar entre pesos, reales y dólares al mejor precio, y te doy un comprobante verificable de cada operación.\n\nProbá: <code>/quote wBRL wARS 200</code>",
    pt: "Oi! Eu sou o Arbolito 🌳, seu cambista. Eu troco entre reais, pesos e dólares pelo melhor preço e te dou um comprovante verificável de cada operação.\n\nExperimente: <code>/quote wBRL wARS 200</code>",
    en: "Hi! I'm Arbolito 🌳, your money-changer. I convert between pesos, reais and dollars at the best rate and give you a verifiable receipt for every trade.\n\nTry: <code>/quote wBRL wARS 200</code>",
  },
  quoteUsage: {
    es: "Uso: <code>/quote DE A MONTO</code>, por ejemplo <code>/quote wBRL wARS 200</code>",
    pt: "Uso: <code>/quote DE PARA VALOR</code>, por exemplo <code>/quote wBRL wARS 200</code>",
    en: "Usage: <code>/quote FROM TO AMOUNT</code>, e.g. <code>/quote wBRL wARS 200</code>",
  },
  privateBeta: {
    es: "Arbolito está en beta privada por ahora. ¡Pronto abrimos para todos! 🌳",
    pt: "O Arbolito está em beta privado por enquanto. Em breve abrimos para todos! 🌳",
    en: "Arbolito is in private beta for now. We open to everyone soon! 🌳",
  },
  quoting: { es: "Buscando el mejor precio…", pt: "Procurando o melhor preço…", en: "Finding the best rate…" },
  noRoute: {
    es: "Ningún mercado cotizó ese monto ahora. ¿Probamos con un monto menor?",
    pt: "Nenhum mercado cotou esse valor agora. Vamos tentar um valor menor?",
    en: "No market quoted that amount right now. Shall we try a smaller amount?",
  },
  youGet: { es: "Recibís", pt: "Você recebe", en: "You get" },
  forWord: { es: "por", pt: "por", en: "for" },
  route: { es: "Ruta", pt: "Rota", en: "Route" },
  vsOfficial: { es: "Vs. oficial", pt: "Vs. oficial", en: "Vs. official" },
  expiresIn: { es: "vence en", pt: "vence em", en: "expires in" },
  minimum: { es: "mínimo garantizado", pt: "mínimo garantido", en: "guaranteed minimum" },
  btnConfirm: { es: "Confirmar", pt: "Confirmar", en: "Confirm" },
  btnAlternatives: { es: "Ver alternativas", pt: "Ver alternativas", en: "See alternatives" },
  btnCancel: { es: "Cancelar", pt: "Cancelar", en: "Cancel" },
  alternatives: { es: "Alternativas", pt: "Alternativas", en: "Alternatives" },
  cancelled: { es: "Listo, cancelado. No se movió nada.", pt: "Pronto, cancelado. Nada foi movido.", en: "Done, cancelled. Nothing moved." },
  expired: {
    es: "Esa cotización venció. Pedí una nueva y te busco el precio actual.",
    pt: "Essa cotação venceu. Peça uma nova e eu busco o preço atual.",
    en: "That quote expired. Ask again and I'll fetch the current rate.",
  },
  notFound: { es: "No encontré esa operación.", pt: "Não encontrei essa operação.", en: "I couldn't find that action." },
  walletNotReady: {
    es: "Todavía no tenés billetera conectada, así que no moví nada. Pronto vas a poder crearla desde la app.",
    pt: "Você ainda não tem carteira conectada, então nada foi movido. Em breve você poderá criá-la pelo app.",
    en: "You don't have a wallet connected yet, so nothing moved. You'll be able to create one from the app soon.",
  },
  error: {
    es: "Algo salió mal de mi lado. No se movió dinero. Probá de nuevo en un momento.",
    pt: "Algo deu errado do meu lado. Nenhum dinheiro foi movido. Tente de novo em instantes.",
    en: "Something went wrong on my side. No money moved. Please try again in a moment.",
  },
} as const satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

export const t = (key: StringKey, lang: Lang): string => STRINGS[key][lang];
