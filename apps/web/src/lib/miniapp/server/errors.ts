import type { ApiErrorCode } from "../contract";

/**
 * A failure the API reports as `{ error: { code, message }, ...extra }` with an HTTP status.
 * Messages are user-safe: never put secrets, claim tokens or raw upstream bodies in them.
 */
export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    /** Extra top-level fields (e.g. the needs_taker_proof challenge). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

export const badRequest = (message: string, status = 400) => new ApiFailure("bad_request", message, status);
export const notFound = (message: string) => new ApiFailure("bad_request", message, 404);
export const noRoute = (message = "No market can quote this pair and size right now.") => new ApiFailure("no_route", message, 422);
export const quoteExpired = (message = "This quote expired. Ask for a new one.") => new ApiFailure("quote_expired", message, 410);
export const priceChanged = (message = "The price moved below the guaranteed minimum. Ask for a new quote.") =>
  new ApiFailure("price_changed", message, 409);
export const notReady = (message: string) => new ApiFailure("not_ready", message, 503);
export const rateLimited = (message = "Too many requests. Wait a minute and try again.") => new ApiFailure("rate_limited", message, 429);
export const upstream = (message = "A market or network service failed. Nothing moved; try again.") => new ApiFailure("upstream", message, 502);
