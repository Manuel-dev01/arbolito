/**
 * HTTP client for the web backend's Mini App API, so Telegram and the mini app share one quote
 * (same quoteId, same expiry). Quotes and receipt reads are free: no payment, no transaction.
 */
import { ApiError, QuoteRequest, QuoteResponse, ReceiptResponse, type ApiErrorCode } from "./contract";

export class MiniAppApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    /** HTTP status, or 0 when the request never got a response. */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MiniAppApiError";
  }
}

export interface MiniAppClientOptions {
  /** PUBLIC_BASE_URL of the web app, e.g. https://arbolito-livid.vercel.app */
  baseUrl: string | undefined;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface MiniAppClient {
  quote(req: QuoteRequest): Promise<QuoteResponse>;
  receipt(id: string): Promise<ReceiptResponse>;
}

export function createMiniAppClient(opts: MiniAppClientOptions): MiniAppClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  async function call<T>(path: string, init: RequestInit, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }): Promise<T> {
    const base = (opts.baseUrl ?? "").replace(/\/$/, "");
    if (!base) throw new MiniAppApiError("not_ready", 0, "PUBLIC_BASE_URL is not set");
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new MiniAppApiError("upstream", 0, `network: ${err instanceof Error ? err.message : String(err)}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new MiniAppApiError("upstream", res.status, `non-JSON response (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const err = ApiError.safeParse(body);
      if (err.success) throw new MiniAppApiError(err.data.error.code, res.status, err.data.error.message.slice(0, 200));
      throw new MiniAppApiError(res.status === 429 ? "rate_limited" : "upstream", res.status, `HTTP ${res.status}`);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new MiniAppApiError("upstream", res.status, "response does not match the contract");
    return parsed.data;
  }

  return {
    async quote(req) {
      const parsed = QuoteRequest.safeParse(req);
      if (!parsed.success) throw new MiniAppApiError("bad_request", 0, "quote request does not match the contract");
      const body = parsed.data;
      return call("/api/miniapp/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, QuoteResponse);
    },
    receipt(id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.reject(new MiniAppApiError("bad_request", 0, "bad receipt id"));
      return call(`/api/miniapp/receipt/${id}`, { method: "GET" }, ReceiptResponse);
    },
  };
}

/** Which user-facing copy a failed quote gets. `no_route` gets its own card, not a plain line. */
export type QuoteErrorCopy = "noMarket" | "rateLimited" | "quoteBad" | "error";

export function quoteErrorCopy(err: unknown): QuoteErrorCopy {
  if (!(err instanceof MiniAppApiError)) return "error";
  switch (err.code) {
    case "no_route":
      return "noMarket";
    case "rate_limited":
      return "rateLimited";
    case "bad_request":
      return "quoteBad";
    default:
      return "error";
  }
}
