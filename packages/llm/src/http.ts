import { LlmApiError, LlmError, LlmNetworkError, LlmTimeoutError, type Provider } from "./errors";

/**
 * fetch with a per-attempt timeout and bounded retries on 429/5xx/timeouts/network errors.
 * Only for calls that move no money (LLM and STT). Paid x402/buy calls must never go through this.
 */

export interface RetryPolicy {
  /** Extra attempts after the first. Default 2. */
  maxRetries?: number;
  /** First backoff delay; doubles per attempt. Default 500ms. */
  baseDelayMs?: number;
  /** Upper bound for any single wait, including a server Retry-After. Default 10s. */
  maxDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  provider: Provider;
  fetchFn: typeof fetch;
  timeoutMs: number;
  /** Caller cancellation. An abort from here is rethrown as-is and never retried. */
  signal?: AbortSignal;
  retry?: RetryPolicy;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retry-After in seconds or as an HTTP date; undefined when absent or unparsable. */
function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(h);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** Returns a 2xx Response. Throws LlmApiError / LlmTimeoutError / LlmNetworkError otherwise. */
export async function requestWithRetry(url: string, init: Omit<RequestInit, "signal">, opts: RequestOptions): Promise<Response> {
  const maxRetries = opts.retry?.maxRetries ?? 2;
  const base = opts.retry?.baseDelayMs ?? 500;
  const cap = opts.retry?.maxDelayMs ?? 10_000;
  const sleep = opts.retry?.sleep ?? defaultSleep;

  for (let attempt = 0; ; attempt++) {
    let error: LlmError;
    let hint: number | undefined;
    const timeout = AbortSignal.timeout(opts.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    try {
      const res = await opts.fetchFn(url, { ...init, signal });
      if (res.ok) return res;
      error = new LlmApiError(opts.provider, res.status, await res.text().catch(() => ""));
      hint = retryAfterMs(res);
    } catch (e) {
      if (opts.signal?.aborted) throw e; // caller cancelled
      error = timeout.aborted ? new LlmTimeoutError(opts.provider, opts.timeoutMs) : new LlmNetworkError(opts.provider, e);
    }
    if (!error.retryable || attempt >= maxRetries) throw error;
    const backoff = base * 2 ** attempt + Math.floor(Math.random() * 250);
    await sleep(Math.min(cap, hint ?? backoff));
  }
}
