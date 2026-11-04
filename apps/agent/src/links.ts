/**
 * Telegram links open a review page. Without a Discover listing the page explains developer-mode
 * access; it cannot sign outside MiniPay. A future approved deep-link template can wrap the URL.
 */
import type { Sym } from "./contract";

export const MINIPAY_OPEN_TEMPLATE: string | null = null;

export function wrapForMiniPay(url: string, template: string | null = MINIPAY_OPEN_TEMPLATE): string {
  return template ? template.replace("{url}", encodeURIComponent(url)) : url;
}

export interface Links {
  /** No Discover ID: the target page explains the manual testing handoff. */
  manualHandoff?: boolean;
  /** "Confirmar en MiniPay": the mini app at this exact quote. */
  quote(quoteId: string): string;
  /** The mini app's send flow, prefilled. */
  send(p: SendLinkParams): string;
  /** "Conectar en MiniPay": the linking screen with the code. */
  link(code: string): string;
}

export interface SendLinkParams {
  /** Recipient as the user named them (contact name) or the address. */
  recipient: string;
  /** Resolved recipient wallet, when known. */
  to?: string;
  /** Human amount of `token` ("200", "10.5"). */
  amount: string;
  token: Sym;
  /** Token the recipient gets, when the send converts. */
  receive?: Sym;
  /** The shared quote for a converting send, if one was taken. */
  quoteId?: string;
}

export function makeLinks(baseUrl: string | undefined, template: string | null = MINIPAY_OPEN_TEMPLATE): Links | null {
  const base = (baseUrl ?? "").replace(/\/$/, "");
  if (!/^https?:\/\//.test(base)) return null;
  const app = (path: string, params: Record<string, string | undefined>) => {
    const u = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
    return wrapForMiniPay(u.toString(), template);
  };
  return {
    manualHandoff: template === null,
    quote: (quoteId) => app("/app", { quote: quoteId }),
    send: (p) => app("/app", { send: p.recipient, to: p.to, amount: p.amount, token: p.token, receive: p.receive, quote: p.quoteId }),
    link: (code) => app("/app/link", { code }),
  };
}

/** Telegram's share sheet for a receipt URL. */
export const shareLink = (url: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}`;
