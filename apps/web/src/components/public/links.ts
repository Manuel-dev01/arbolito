/**
 * Outbound links for the public site.
 *
 * MiniPay deeplinks (docs.minipay.xyz/technical-references/deeplinks.html, checked 2026-10-11):
 * a specific mini app opens with `https://link.minipay.xyz/miniapp?id=<Discover listing UUID>`.
 * The URL-based `/browse?url=` form is deprecated for mini apps (its domain whitelist is no
 * longer maintained). Arbolito has no Discover listing id yet, so the CTA opens MiniPay's
 * Discover tab (`/discover`), which is also where an unknown id lands. Set the id here once
 * the listing exists.
 */
export const MINIPAY_MINIAPP_ID: string | null = null;

export const MINIPAY_URL = MINIPAY_MINIAPP_ID ? `https://link.minipay.xyz/miniapp?id=${MINIPAY_MINIAPP_ID}` : "https://link.minipay.xyz/discover";

export const TELEGRAM_URL = "https://t.me/arbolitoo_bot";
