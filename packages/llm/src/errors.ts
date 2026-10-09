/**
 * Typed errors for LLM and speech-to-text calls. Messages never include API keys or headers;
 * response bodies are truncated so a chatty upstream can't flood the logs.
 */

export type Provider = "deepseek" | "anthropic" | "groq";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: Provider,
    /** True when retrying the same request could succeed (rate limit, 5xx, timeout, network). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** Non-2xx HTTP response from the provider. */
export class LlmApiError extends LlmError {
  constructor(
    provider: Provider,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${provider} API ${status}: ${body.slice(0, 300)}`, provider, status === 429 || status >= 500);
    this.name = "LlmApiError";
  }
}

export class LlmTimeoutError extends LlmError {
  constructor(
    provider: Provider,
    readonly timeoutMs: number,
  ) {
    super(`${provider} request timed out after ${timeoutMs}ms`, provider, true);
    this.name = "LlmTimeoutError";
  }
}

/** fetch itself failed (DNS, reset, TLS). */
export class LlmNetworkError extends LlmError {
  constructor(provider: Provider, cause: unknown) {
    super(`${provider} network error: ${cause instanceof Error ? cause.message : String(cause)}`, provider, true);
    this.name = "LlmNetworkError";
  }
}

/** 2xx response whose body doesn't match the expected shape. */
export class LlmResponseError extends LlmError {
  constructor(provider: Provider, detail: string) {
    super(`${provider} returned an unexpected response: ${detail.slice(0, 300)}`, provider, false);
    this.name = "LlmResponseError";
  }
}

/** Missing key, unsupported provider, or a provider that isn't implemented yet. */
export class LlmConfigError extends LlmError {
  constructor(provider: Provider, message: string) {
    super(message, provider, false);
    this.name = "LlmConfigError";
  }
}
