/**
 * Links from Telegram into the Arbolito Mini App (MINI_APP_URL, falling back to PUBLIC_BASE_URL).
 *
 * MiniPay deeplink: docs.minipay.xyz was unreachable when this was written, so no MiniPay URL
 * scheme is assumed (CLAUDE.md: never invent an endpoint). Plain HTTPS links open the mini app
 * in the phone's browser. Once the docs confirm a "open this URL inside MiniPay" deeplink, set
 * MINIPAY_OPEN_TEMPLATE to it ({url} is replaced by the encoded mini app URL); every link
 * below goes through `wrap`, so that is the only change needed.
 */
import type { Sym } from "./contract";

export const MINIPAY_OPEN_TEMPLATE: string | null = null;

export function wrapForMiniPay(url: string, template: string | null = MINIPAY_OPEN_TEMPLATE): string {
  return template ? template.replace("{url}", encodeURIComponent(url)) : url;
}

export interface Links {
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
    quote: (quoteId) => app("/app", { quote: quoteId }),
    send: (p) => app("/app", { send: p.recipient, to: p.to, amount: p.amount, token: p.token, receive: p.receive, quote: p.quoteId }),
    link: (code) => app("/app/link", { code }),
  };
}

/** Telegram's share sheet for a receipt URL. */
export const shareLink = (url: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}`;
