import type { z } from "zod";
import { redact } from "@arbolito/chain";
import { ApiFailure, badRequest } from "./errors";

/** Strip bearer capabilities (Textile claim tokens, poll URLs, configured secrets) before logging. */
export function scrub(text: string): string {
  return redact(text).replace(/(claim[_-]?token|x-rfq-claim)(["'\s:=]+)[^"'\s,}]+/gi, "$1$2[claim]");
}

export function logError(where: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[miniapp] ${where}: ${scrub(msg).slice(0, 400)}`);
}

/**
 * Errors from calls made with a Textile claim token: log the kind and HTTP status only, never the
 * message or body (an upstream error could echo the token back).
 */
export function logTextileError(where: string, err: unknown): void {
  const status = typeof (err as { status?: unknown })?.status === "number" ? ` ${(err as { status: number }).status}` : "";
  console.error(`[miniapp] ${where}: ${err instanceof Error ? err.name : "error"}${status}`);
}

const NO_STORE = { "cache-control": "no-store" };

export function errorResponse(f: ApiFailure): Response {
  return Response.json({ ...(f.extra ?? {}), error: { code: f.code, message: f.message } }, { status: f.status, headers: NO_STORE });
}

/** Parse a JSON body against the contract schema, or throw bad_request with the issues. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Body must be JSON.");
  }
  return parseInput(schema, raw);
}

export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ").slice(0, 300));
  }
  return parsed.data;
}

/** Client IP for rate limiting (Vercel sets x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

/**
 * Runs a handler and turns its result into a response validated against the contract schema.
 * ApiFailure → its code and status. Anything else is logged (scrubbed) and reported as upstream.
 */
export async function respond<S extends z.ZodType>(where: string, schema: S, fn: () => Promise<z.infer<S>>, status = 200): Promise<Response> {
  try {
    const body = await fn();
    const checked = schema.safeParse(body);
    if (!checked.success) {
      logError(`${where} response`, new Error(checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
      return errorResponse(new ApiFailure("upstream", "The server built an invalid response. Nothing moved.", 500));
    }
    return Response.json(checked.data, { status, headers: NO_STORE });
  } catch (err) {
    if (err instanceof ApiFailure) return errorResponse(err);
    logError(where, err);
    return errorResponse(new ApiFailure("upstream", "Something failed on our side or upstream. Nothing moved; try again.", 502));
  }
}
