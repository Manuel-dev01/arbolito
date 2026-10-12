/**
 * Typed client for /api/miniapp/* (see ../contract.ts). Every response is zod-parsed; anything
 * that doesn't match the contract is an error, never a silent success.
 */
import { z } from "zod";
import {
  ApiError,
  AutonomyPlanRequest,
  AutonomyStatus,
  BalancesResponse,
  CallsResponse,
  ChatRequest,
  ChatResponse,
  LinkConfirmRequest,
  LinkConfirmResponse,
  NeedsTakerProof,
  PrepareRequest,
  PrepareResponse,
  QuoteRequest,
  QuoteResponse,
  RatesResponse,
  ReceiptResponse,
  RevokePlanRequest,
  SubmitRequest,
  SubmitResponse,
  Sym,
} from "../contract";
import type { ClientErrorCode } from "./errors";

export type Rates = z.infer<typeof RatesResponse>;
export type Balances = z.infer<typeof BalancesResponse>;
export type Quote = z.infer<typeof QuoteResponse>;
export type Prepared = z.infer<typeof PrepareResponse>;
export type NeedsProof = z.infer<typeof NeedsTakerProof>;
export type Submitted = z.infer<typeof SubmitResponse>;
export type Receipt = z.infer<typeof ReceiptResponse>;
export type AutoStatus = z.infer<typeof AutonomyStatus>;
export type ChatReply = z.infer<typeof ChatResponse>;
export type LinkResult = z.infer<typeof LinkConfirmResponse>;
export type Calls = z.infer<typeof CallsResponse>;

/**
 * TODO(contract): a send-to-contact endpoint. The contract's /quote and /prepare have no recipient,
 * so a cross-currency send ("Graciela recibe pesos") can't be prepared. The UI calls this shape at
 * POST /api/miniapp/send/prepare and treats a 404 as `not_ready`.
 */
export const SendPrepareRequest = z.object({
  account: z.string(),
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  from: Sym,
  to: Sym,
  amount: z.string(),
  quoteId: z.string().uuid().optional(),
});
export type SendPrepareRequest = z.infer<typeof SendPrepareRequest>;

export class ApiFailure extends Error {
  constructor(
    readonly code: ClientErrorCode,
    readonly status: number,
    message: string,
    /** Set on 409 needs_taker_proof: what the wallet must sign before retrying /prepare. */
    readonly proof?: NeedsProof,
  ) {
    super(message);
    this.name = "ApiFailure";
  }
}

export interface ApiClient {
  rates(): Promise<Rates>;
  balances(account: string): Promise<Balances>;
  quote(req: z.input<typeof QuoteRequest>): Promise<Quote>;
  /** TODO(contract): GET /api/miniapp/quote/:id, so a Telegram deep link can show the quote it opens. */
  quoteById(id: string): Promise<Quote>;
  prepare(req: z.input<typeof PrepareRequest>): Promise<Prepared>;
  submit(req: z.input<typeof SubmitRequest>): Promise<Submitted>;
  receipt(id: string): Promise<Receipt>;
  autonomyPlan(req: z.input<typeof AutonomyPlanRequest>): Promise<Calls>;
  autonomyStatus(account: string): Promise<AutoStatus>;
  revokePlan(req: z.input<typeof RevokePlanRequest>): Promise<Calls>;
  /** TODO(contract): pausing "al instante, sin confirmar en MiniPay" needs a server endpoint. */
  autonomyPause(account: string, paused: boolean): Promise<{ paused: boolean }>;
  chat(req: z.input<typeof ChatRequest>): Promise<ChatReply>;
  linkConfirm(req: z.input<typeof LinkConfirmRequest>): Promise<LinkResult>;
  /** TODO(contract): see SendPrepareRequest. */
  sendPrepare(req: SendPrepareRequest): Promise<Calls & { expectedOut: string; minOut: string }>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  /** Origin + prefix, default "/api/miniapp". */
  base?: string;
  fetch?: FetchLike;
}

const SendPrepareResponse = CallsResponse.extend({ expectedOut: z.string().regex(/^\d+$/), minOut: z.string().regex(/^\d+$/) });
const PauseResponse = z.object({ paused: z.boolean() });

export function createApiClient(opts: ApiOptions = {}): ApiClient {
  const base = opts.base ?? "/api/miniapp";
  const doFetch: FetchLike = opts.fetch ?? ((i, init) => fetch(i, init));

  async function call<T extends z.ZodType>(schema: T, path: string, init?: { method?: string; body?: unknown }): Promise<z.infer<T>> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method: init?.method ?? "GET",
        headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      });
    } catch (e) {
      throw new ApiFailure("network", 0, e instanceof Error ? e.message : "network error");
    }
    let json: unknown = undefined;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      if (res.status === 409) {
        const p = NeedsTakerProof.safeParse(json);
        if (p.success) throw new ApiFailure("needs_taker_proof", 409, p.data.error.message, p.data);
      }
      const e = ApiError.safeParse(json);
      if (e.success) throw new ApiFailure(e.data.error.code, res.status, e.data.error.message);
      // A route that doesn't exist yet (404) is a feature that isn't ready, not a failure.
      if (res.status === 404) throw new ApiFailure("not_ready", 404, "not found");
      if (res.status === 429) throw new ApiFailure("rate_limited", 429, "rate limited");
      throw new ApiFailure("upstream", res.status, `HTTP ${res.status}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiFailure("bad_response", res.status, `response for ${path} does not match the contract`);
    return parsed.data;
  }

  const q = (account: string) => `?account=${encodeURIComponent(account)}`;

  return {
    rates: () => call(RatesResponse, "/rates"),
    balances: (account) => call(BalancesResponse, `/balances${q(account)}`),
    quote: (req) => call(QuoteResponse, "/quote", { method: "POST", body: QuoteRequest.parse(req) }),
    quoteById: (id) => call(QuoteResponse, `/quote/${encodeURIComponent(id)}`),
    prepare: (req) => call(PrepareResponse, "/prepare", { method: "POST", body: PrepareRequest.parse(req) }),
    submit: (req) => call(SubmitResponse, "/submit", { method: "POST", body: SubmitRequest.parse(req) }),
    receipt: (id) => call(ReceiptResponse, `/receipt/${encodeURIComponent(id)}`),
    autonomyPlan: (req) => call(CallsResponse, "/autonomy/plan", { method: "POST", body: AutonomyPlanRequest.parse(req) }),
    autonomyStatus: (account) => call(AutonomyStatus, `/autonomy/status${q(account)}`),
    revokePlan: (req) => call(CallsResponse, "/autonomy/revoke-plan", { method: "POST", body: RevokePlanRequest.parse(req) }),
    autonomyPause: (account, paused) => call(PauseResponse, "/autonomy/pause", { method: "POST", body: { account, paused } }),
    chat: (req) => call(ChatResponse, "/chat", { method: "POST", body: ChatRequest.parse(req) }),
    linkConfirm: (req) => call(LinkConfirmResponse, "/link/confirm", { method: "POST", body: LinkConfirmRequest.parse(req) }),
    sendPrepare: (req) => call(SendPrepareResponse, "/send/prepare", { method: "POST", body: SendPrepareRequest.parse(req) }),
  };
}

export function errorCode(e: unknown): ClientErrorCode {
  return e instanceof ApiFailure ? e.code : "network";
}
