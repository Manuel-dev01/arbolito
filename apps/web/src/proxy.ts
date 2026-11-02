import { NextResponse, type NextRequest } from "next/server";

/**
 * Anything that starts like /app but isn't a real page goes to /app (query kept). People type the
 * address into MiniPay's "Load test page" on a phone. That field keeps the last address, so new text
 * gets appended to it: on 2026-11-02 MiniPay requested
 * "/apphttps:/arbolito-livid.vercel.app/appThis%20link" and showed our 404. Keyboards also
 * capitalise ("/App") and paste adds spaces ("/app%20").
 */
const REAL = /^\/app(\/link)?\/?$/;

export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (REAL.test(path)) return NextResponse.next();
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // malformed escapes: judge the raw path
  }
  const lower = decoded.trim().toLowerCase();
  if (!lower.startsWith("/app") || lower.startsWith("/apple-icon")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = REAL.test(lower.replace(/[\s.,;:!]+$/, "")) ? lower.replace(/[\s.,;:!/]+$/, "") : "/app";
  return NextResponse.redirect(url, 308);
}

// Skips assets, the API and the known pages; everything else is checked (cheaply) above.
export const config = { matcher: ["/((?!_next/|api/|r/|desk|metrics|minipay-check|favicon|icon|apple-icon).+)"] };
