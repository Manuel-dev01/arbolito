import { NextResponse, type NextRequest } from "next/server";

/**
 * Near-misses of /app go to /app. People type it into MiniPay's "Load test page" on a phone, where
 * the keyboard capitalises ("/App") or pasting adds a space ("/app%20"); both used to land on a
 * 404 (2026-11-02). The query string (?mock=1, ?lang=) is kept.
 */
export function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path === "/app") return NextResponse.next();
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return NextResponse.next(); // malformed escapes: let the normal 404 answer
  }
  const clean = decoded.trim().toLowerCase().replace(/[\s.,;:!/]+$/, "");
  if (clean !== "/app") return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/app";
  return NextResponse.redirect(url, 308);
}

// Skips assets, the API and the known pages; everything else is checked (cheaply) above.
export const config = { matcher: ["/((?!_next/|api/|r/|desk|metrics|minipay-check|favicon|icon|apple-icon).+)"] };
