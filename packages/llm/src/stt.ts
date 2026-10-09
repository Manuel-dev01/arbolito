import { z } from "zod";
import { loadEnv } from "@arbolito/config";
import { LlmConfigError, LlmResponseError, LlmTimeoutError } from "./errors";
import { requestWithRetry, type RetryPolicy } from "./http";

/**
 * Speech-to-text for Telegram voice notes: Groq Whisper via the OpenAI-compatible
 * POST /openai/v1/audio/transcriptions (multipart: file, model, optional language).
 * Retries 429/5xx at most twice (moves no money).
 */

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_STT_MODEL = "whisper-large-v3-turbo";
/** Groq's upload limit for direct file uploads. */
const MAX_BYTES = 25 * 1024 * 1024;

export interface TranscribeOptions {
  /** e.g. "voice.ogg". Groq uses the extension to detect the format. */
  filename: string;
  /** e.g. "audio/ogg" (Telegram voice notes are OGG/Opus). */
  mimeType: string;
  /** ISO-639-1 hint ("es", "pt", "en"); improves accuracy and latency. */
  language?: string;
  /** Defaults to STT_API_KEY. */
  apiKey?: string;
  /** Defaults to STT_PROVIDER (only "groq" is supported). */
  provider?: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
  /** Per-attempt timeout. Default 30s. */
  timeoutMs?: number;
  signal?: AbortSignal;
  retry?: RetryPolicy;
}

export interface Transcription {
  text: string;
  /** Detected language, when the provider reports it (verbose_json only). */
  language?: string;
}

const responseSchema = z.object({ text: z.string(), language: z.string().optional() }).passthrough();

export async function transcribe(audio: Uint8Array, opts: TranscribeOptions): Promise<Transcription> {
  const provider = opts.provider ?? loadEnv().STT_PROVIDER ?? "groq";
  if (provider !== "groq") throw new LlmConfigError("groq", `STT_PROVIDER=${provider} is not supported; use groq`);
  const apiKey = opts.apiKey ?? loadEnv().STT_API_KEY;
  if (!apiKey) throw new LlmConfigError("groq", "STT_API_KEY is not set");
  if (audio.byteLength === 0) throw new RangeError("audio is empty");
  if (audio.byteLength > MAX_BYTES) throw new RangeError(`audio is ${audio.byteLength} bytes; the limit is ${MAX_BYTES}`);

  const form = new FormData();
  // Copy into a fresh ArrayBuffer-backed view: Blob rejects SharedArrayBuffer-backed input.
  form.append("file", new Blob([new Uint8Array(audio)], { type: opts.mimeType }), opts.filename);
  form.append("model", opts.model ?? GROQ_STT_MODEL);
  form.append("response_format", "json");
  if (opts.language) form.append("language", opts.language);

  const timeoutMs = opts.timeoutMs ?? 30_000;
  const base = (opts.baseUrl ?? GROQ_BASE_URL).replace(/\/$/, "");
  // No content-type header: fetch sets the multipart boundary itself.
  const res = await requestWithRetry(
    `${base}/audio/transcriptions`,
    { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form },
    { provider: "groq", fetchFn: opts.fetchFn ?? fetch, timeoutMs, signal: opts.signal, retry: opts.retry },
  );

  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new LlmTimeoutError("groq", timeoutMs);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LlmResponseError("groq", `invalid JSON: ${text}`);
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new LlmResponseError("groq", parsed.error.message);
  return { text: parsed.data.text.trim(), ...(parsed.data.language ? { language: parsed.data.language } : {}) };
}
