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
  LinkStatusResponse,
  NeedsTakerProof,
  OpenQuoteResponse,
  ReceiptsListResponse,
  PrepareRequest,
  PrepareResponse,
  QuoteRequest,
  QuoteResponse,
  RatesResponse,
  ReceiptResponse,
  RevokePlanRequest,
  RuleCancelRequest,
  RuleConfirmRequest,
  RuleResponse,
  RulesListResponse,
  SubmitRequest,
  SubmitResponse,
  Sym,
} from "../contract";
import type { ClientErrorCode } from "./errors";

export type Rates = z.infer<typeof RatesResponse>;
export type Balances = z.infer<typeof BalancesResponse>;
export type Quote = z.infer<typeof QuoteResponse>;
export type RulesList = z.infer<typeof RulesListResponse>;
export type Rule = RulesList["rules"][number];
export type Prepared = z.infer<typeof PrepareResponse>;
export type NeedsProof = z.infer<typeof NeedsTakerProof>;
export type Submitted = z.infer<typeof SubmitResponse>;
export type Receipt = z.infer<typeof ReceiptResponse>;
export type AutoStatus = z.infer<typeof AutonomyStatus>;
export type ChatReply = z.infer<typeof ChatResponse>;
export type LinkResult = z.infer<typeof LinkConfirmResponse>;
export type Calls = z.infer<typeof CallsResponse>;

/** POST /api/miniapp/send/prepare (server: lib/miniapp/server/send.ts, contract SendPrepareRequest). */
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
  /** GET /api/miniapp/quotes/open: the account's latest open (quoted, unexpired) quote, or null. */
  openQuote(account: string): Promise<Quote | null>;
  listReceipts(account: string): Promise<z.infer<typeof ReceiptsListResponse>["receipts"]>;
  prepare(req: z.input<typeof PrepareRequest>): Promise<Prepared>;
  submit(req: z.input<typeof SubmitRequest>): Promise<Submitted>;
  receipt(id: string): Promise<Receipt>;
  autonomyPlan(req: z.input<typeof AutonomyPlanRequest>): Promise<Calls>;
  /** candidates: the phone's contact wallets, so the guard can say which are allowed. */
  autonomyStatus(account: string, candidates?: string[]): Promise<AutoStatus>;
  linkStatus(account: string): Promise<z.infer<typeof LinkStatusResponse>>;
  revokePlan(req: z.input<typeof RevokePlanRequest>): Promise<Calls>;
  /** TODO(contract): pausing "al instante, sin confirmar en MiniPay" needs a server endpoint. */
  autonomyPause(account: string, paused: boolean): Promise<{ paused: boolean }>;
  chat(req: z.input<typeof ChatRequest>): Promise<ChatReply>;
  linkConfirm(req: z.input<typeof LinkConfirmRequest>): Promise<LinkResult>;
  /**
   * POST /api/miniapp/reject (backend route outside the shared contract): MiniPay's sheet was
   * declined (4001). Marks the quote failed / rejected_in_minipay so Telegram's card follows.
   */
  reject(req: { quoteId: string; account: string; code?: number }): Promise<{ quoteId: string; status: string }>;
  sendPrepare(req: SendPrepareRequest): Promise<Calls & { expectedOut: string; minOut: string }>;
  listRules(account: string): Promise<RulesList>;
  confirmRule(req: z.input<typeof RuleConfirmRequest>): Promise<Rule>;
  cancelRule(req: z.input<typeof RuleCancelRequest>): Promise<Rule>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
  /** Origin + prefix, default "/api/miniapp". */
  base?: string;
  fetch?: FetchLike;
}

const SendPrepareResponse = CallsResponse.extend({ expectedOut: z.string().regex(/^\d+$/), minOut: z.string().regex(/^\d+$/) });
const PauseResponse = z.object({ paused: z.boolean() });
/** Mirrors lib/miniapp/server/reject.ts (server-only module, so not imported here). */
const RejectRequest = z.object({ quoteId: z.string().uuid(), account: z.string().regex(/^0x[0-9a-fA-F]{40}$/), code: z.number().int().optional() });
const RejectResponse = z.object({ quoteId: z.string().uuid(), status: z.string() });

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

  /** Validates a request body against the contract before sending; a bad body never leaves the phone. */
  function req<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
    const r = schema.safeParse(body);
    if (!r.success) throw new ApiFailure("bad_request", 0, "request does not match the contract");
    return r.data;
  }

  const q = (account: string) => `?account=${encodeURIComponent(account)}`;

  return {
    rates: () => call(RatesResponse, "/rates"),
    balances: (account) => call(BalancesResponse, `/balances${q(account)}`),
    quote: async (r) => call(QuoteResponse, "/quote", { method: "POST", body: req(QuoteRequest, r) }),
    quoteById: (id) => call(QuoteResponse, `/quote/${encodeURIComponent(id)}`),
    openQuote: async (account) => (await call(OpenQuoteResponse, `/quotes/open${q(account)}`)).quote,
    listReceipts: async (account) => (await call(ReceiptsListResponse, `/receipts${q(account)}`)).receipts,
    prepare: async (r) => call(PrepareResponse, "/prepare", { method: "POST", body: req(PrepareRequest, r) }),
    submit: async (r) => call(SubmitResponse, "/submit", { method: "POST", body: req(SubmitRequest, r) }),
    receipt: (id) => call(ReceiptResponse, `/receipt/${encodeURIComponent(id)}`),
    autonomyPlan: async (r) => call(CallsResponse, "/autonomy/plan", { method: "POST", body: req(AutonomyPlanRequest, r) }),
    autonomyStatus: (account, candidates = []) =>
      call(AutonomyStatus, `/autonomy/status${q(account)}${candidates.length ? `&candidates=${candidates.slice(0, 50).join(",")}` : ""}`),
    linkStatus: (account) => call(LinkStatusResponse, `/link/status${q(account)}`),
    revokePlan: async (r) => call(CallsResponse, "/autonomy/revoke-plan", { method: "POST", body: req(RevokePlanRequest, r) }),
    autonomyPause: (account, paused) => call(PauseResponse, "/autonomy/pause", { method: "POST", body: { account, paused } }),
    chat: async (r) => call(ChatResponse, "/chat", { method: "POST", body: req(ChatRequest, r) }),
    linkConfirm: async (r) => call(LinkConfirmResponse, "/link/confirm", { method: "POST", body: req(LinkConfirmRequest, r) }),
    reject: async (r) => call(RejectResponse, "/reject", { method: "POST", body: req(RejectRequest, r) }),
    sendPrepare: async (r) => call(SendPrepareResponse, "/send/prepare", { method: "POST", body: req(SendPrepareRequest, r) }),
    listRules: (account) => call(RulesListResponse, `/rules${q(account)}`),
    confirmRule: async (r) => (await call(RuleResponse, "/rules/confirm", { method: "POST", body: req(RuleConfirmRequest, r) })).rule,
    cancelRule: async (r) => (await call(RuleResponse, "/rules/cancel", { method: "POST", body: req(RuleCancelRequest, r) })).rule,
  };
}

export function errorCode(e: unknown): ClientErrorCode {
  return e instanceof ApiFailure ? e.code : "network";
}
