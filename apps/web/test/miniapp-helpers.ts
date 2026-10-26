// Fakes for the Mini App backend tests: no RPC, no Postgres, no Textile, no LLM/STT, no anchoring.
import { randomUUID } from "node:crypto";
import { encodeAbiParameters, encodeEventTopics, pad, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CONTRACTS, TOKENS } from "@arbolito/config";
import type { ChatMessage, ChatRequest as LlmChatRequest, ChatResult, LlmClient } from "@arbolito/llm";
import { erc20Abi, type Quote, type QuoteParams, type TextileFirm, type VenueAdapter } from "@arbolito/router";
import type { MiniappDeps, TextileTaker } from "../src/lib/miniapp/server/deps";
import { RateLimiter } from "../src/lib/miniapp/server/rate-limit";
import type { LinkCodeRow, MiniappStore, NewQuote, NewReceipt, NewRuleDraft, QuotePatch, QuoteRow, ReceiptRow, RuleRow, RuleRunRow, UserRow } from "../src/lib/miniapp/server/store";
import { trimHistory } from "../src/lib/miniapp/server/store";

// Anvil dev key #2: signs in memory only (never funded, never broadcast; see docs/04 on dev keys).
export const wallet = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
export const ACCOUNT = wallet.address.toLowerCase() as Address;
export const OTHER = "0x1111111111111111111111111111111111111111" as Address;
export const CODE = "arbolito_test";
export const T0 = Date.parse("2026-10-12T12:00:00Z");
export const BLOCK = 80_000_000n;
export const CLAIM = "SECRET-CLAIM-TOKEN-do-not-leak";

// ── In-memory store ─────────────────────────────────────────────────────

export class MemoryStore implements MiniappStore {
  users: UserRow[] = [];
  quotes: QuoteRow[] = [];
  receipts: ReceiptRow[] = [];
  messages: { userId: string; content: ChatMessage }[] = [];
  codes: LinkCodeRow[] = [];
  rules: RuleRow[] = [];
  runs: (RuleRunRow & { kind: string })[] = [];

  async insertRuleDraft(r: NewRuleDraft) {
    const row: RuleRow = { ...r, account: r.account.toLowerCase(), status: "draft", signature: null, confirmedAt: null, nextRunAt: null, cursorBlock: null, stoppedReason: null, createdAt: new Date(T0 + this.rules.length), updatedAt: new Date(T0) };
    this.rules.push(row);
    return row;
  }
  async getRule(id: string) {
    return this.rules.find((r) => r.id === id);
  }
  async activateRule(id: string, a: { signature: string; nextRunAt: Date | null; cursorBlock: bigint | null; now: Date }) {
    const r = this.rules.find((x) => x.id === id && x.status === "draft");
    if (!r) return false;
    Object.assign(r, { status: "active", signature: a.signature, confirmedAt: a.now, nextRunAt: a.nextRunAt, cursorBlock: a.cursorBlock });
    return true;
  }
  async cancelRule(id: string) {
    const r = this.rules.find((x) => x.id === id && x.status !== "cancelled");
    if (!r) return false;
    Object.assign(r, { status: "cancelled", nextRunAt: null });
    return true;
  }
  async listRules(account: string) {
    return this.rules.filter((r) => r.account === account.toLowerCase() && r.status !== "cancelled").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  pauses = new Map<string, { paused: boolean; signedAt: Date }>();
  async isPaused(account: string) {
    return this.pauses.get(account.toLowerCase())?.paused ?? false;
  }
  async setPause(account: string, p: { paused: boolean; signedAt: Date; signature: string }) {
    const prev = this.pauses.get(account.toLowerCase());
    if (prev && prev.signedAt >= p.signedAt) return false;
    this.pauses.set(account.toLowerCase(), { paused: p.paused, signedAt: p.signedAt });
    return true;
  }
  async ruleRuns(account: string, limit: number) {
    const mine = new Set(this.rules.filter((r) => r.account === account.toLowerCase()).map((r) => r.id));
    return this.runs.filter((x) => mine.has(x.ruleId)).slice(0, limit);
  }

  addUser(p: Partial<UserRow> = {}): UserRow {
    const row: UserRow = {
      id: randomUUID(),
      telegramId: null,
      telegramUsername: null,
      displayName: null,
      language: "es",
      walletAddress: null,
      walletKind: null,
      maxActionMicros: "25000000",
      maxDailyMicros: "100000000",
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
      ...p,
    };
    this.users.push(row);
    return row;
  }

  async walletUser(wallet: string, language?: string) {
    return (await this.userByWallet(wallet)) ?? this.addUser({ walletAddress: wallet.toLowerCase(), ...(language ? { language } : {}) });
  }
  async userByWallet(wallet: string) {
    return this.users.find((u) => u.walletAddress === wallet.toLowerCase());
  }
  async userById(id: string) {
    return this.users.find((u) => u.id === id);
  }
  async setUserWallet(userId: string, wallet: string) {
    if (this.users.some((u) => u.walletAddress === wallet.toLowerCase() && u.id !== userId)) throw new Error("unique violation users.wallet_address");
    this.users.find((u) => u.id === userId)!.walletAddress = wallet.toLowerCase();
  }
  async deleteUser(id: string) {
    this.users = this.users.filter((u) => u.id !== id);
    this.messages = this.messages.filter((m) => m.userId !== id); // cascade
  }
  async moveUserData(from: string, to: string) {
    for (const r of this.receipts) if (r.userId === from) r.userId = to;
    for (const m of this.messages) if (m.userId === from) m.userId = to;
  }
  async insertQuote(q: NewQuote) {
    const row: QuoteRow = {
      id: randomUUID(),
      account: q.account ?? null,
      fromSym: q.fromSym,
      toSym: q.toSym,
      amountIn: q.amountIn,
      payload: q.payload,
      expiresAt: q.expiresAt,
      status: "quoted",
      prepared: null,
      receiptId: null,
      error: null,
      createdAt: new Date(T0),
      updatedAt: new Date(T0),
    };
    this.quotes.push(row);
    return structuredClone(row);
  }
  async getQuote(id: string) {
    const q = this.quotes.find((x) => x.id === id);
    return q ? structuredClone(q) : undefined;
  }
  async latestOpenQuote(account: string, now: Date) {
    const open = this.quotes.filter((q) => q.account === account.toLowerCase() && q.status === "quoted" && q.expiresAt > now);
    const q = open[open.length - 1]; // inserted in order: last = newest
    return q ? structuredClone(q) : undefined;
  }
  async updateQuote(id: string, patch: QuotePatch, fromStatus?: readonly string[]) {
    const q = this.quotes.find((x) => x.id === id);
    if (!q || (fromStatus && !fromStatus.includes(q.status))) return false;
    Object.assign(q, structuredClone(patch));
    return true;
  }
  async insertReceipt(r: NewReceipt) {
    if (this.receipts.some((x) => x.id === r.id || x.executionTx === r.executionTx || x.bundleHash === r.bundleHash)) return false;
    const c = structuredClone(r);
    this.receipts.push({
      ...c,
      userId: c.userId ?? null,
      anchorTx: c.anchorTx ?? null,
      anchorBlock: c.anchorBlock ?? null,
      savingsBps: c.savingsBps ?? null,
      supersededBy: c.supersededBy ?? null,
      createdAt: new Date(T0),
    });
    return true;
  }
  async getReceipt(id: string) {
    return this.receipts.find((r) => r.id === id);
  }
  async receiptByExecutionTx(tx: string) {
    return this.receipts.find((r) => r.executionTx === tx);
  }
  async receiptsByTaker(taker: string, limit: number) {
    return this.receipts
      .filter((r) => r.taker === taker.toLowerCase())
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
  async setReceiptAnchor(id: string, anchorTx: string, anchorBlock: bigint) {
    Object.assign(this.receipts.find((r) => r.id === id)!, { anchorTx, anchorBlock });
  }
  async loadHistory(userId: string, limit: number) {
    return trimHistory(this.messages.filter((m) => m.userId === userId).slice(-limit).map((m) => m.content));
  }
  async appendHistory(userId: string, msgs: ChatMessage[]) {
    for (const content of msgs) this.messages.push({ userId, content });
  }
  addCode(p: Partial<LinkCodeRow> & { code: string; userId: string }): LinkCodeRow {
    const row: LinkCodeRow = { id: randomUUID(), expiresAt: new Date(T0 + 600_000), usedAt: null, account: null, createdAt: new Date(T0), ...p };
    this.codes.push(row);
    return row;
  }
  async activeLinkCodes(code: string, now: Date) {
    return this.codes.filter((c) => c.code === code && !c.usedAt && c.expiresAt > now);
  }
  async useLinkCode(id: string, account: string, now: Date) {
    const c = this.codes.find((x) => x.id === id);
    if (!c || c.usedAt) return false;
    c.usedAt = now;
    c.account = account.toLowerCase();
    return true;
  }
  async transaction<T>(fn: (s: MiniappStore) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

// ── Fake chain ──────────────────────────────────────────────────────────

export interface FakeTx {
  from: Address;
  to: Address;
  input: Hex;
  value?: bigint;
  status?: "success" | "reverted";
  logs?: { address: Address; topics: Hex[]; data: Hex }[];
}

export class FakeChain {
  block = BLOCK;
  balances = new Map<string, bigint>(); // `${token}:${owner}` lowercased
  allowances = new Map<string, bigint>(); // `${token}:${owner}:${spender}`
  txs = new Map<string, FakeTx>();
  /** Answers for guard reads: functionName → (args) => result. */
  reads: Record<string, (args: readonly unknown[]) => unknown> = {};
  /** Uniswap quoter answers (USD pricing): amountOut per call. */
  quoterOut: (tokenIn: Address, amountIn: bigint) => bigint = (_t, a) => a / 10n ** 12n / 1600n;
  logs: unknown[] = [];

  setTx(hash: Hex, tx: FakeTx) {
    this.txs.set(hash.toLowerCase(), tx);
  }

  client(): PublicClient {
    const self = this;
    return {
      async getBlockNumber() {
        return self.block;
      },
      async getChainId() {
        return 42220;
      },
      async readContract(p: { address: Address; functionName: string; args?: readonly unknown[] }) {
        const args = p.args ?? [];
        if (p.functionName === "allowance") {
          return self.allowances.get(`${p.address}:${args[0]}:${args[1]}`.toLowerCase()) ?? 0n;
        }
        if (p.functionName === "balanceOf") return self.balances.get(`${p.address}:${args[0]}`.toLowerCase()) ?? 0n;
        if (p.functionName === "quoteExactInputSingle") {
          const q = args[0] as { tokenIn: Address; amountIn: bigint };
          return [self.quoterOut(q.tokenIn, q.amountIn), 0n, 0, 0n];
        }
        const r = self.reads[p.functionName];
        if (!r) throw new Error(`unexpected read ${p.functionName}`);
        return r(args);
      },
      async multicall(p: { contracts: { address: Address; functionName: string; args: readonly unknown[] }[] }) {
        return Promise.all(p.contracts.map((c) => (this as PublicClient).readContract(c as never)));
      },
      async getTransaction({ hash }: { hash: Hex }) {
        const t = self.txs.get(hash.toLowerCase());
        if (!t) throw new Error("TransactionNotFoundError");
        return { hash, from: t.from, to: t.to, input: t.input, value: t.value ?? 0n, blockNumber: self.block };
      },
      async getTransactionReceipt({ hash }: { hash: Hex }) {
        const t = self.txs.get(hash.toLowerCase());
        if (!t) throw new Error("TransactionReceiptNotFoundError");
        return { transactionHash: hash, status: t.status ?? "success", blockNumber: self.block, logs: t.logs ?? [] };
      },
      async getLogs() {
        return self.logs;
      },
    } as unknown as PublicClient;
  }
}

/** An ERC-20 Transfer log as it appears in a receipt. */
export function transferLog(token: Address, from: Address, to: Address, value: bigint) {
  const topics = encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }) as Hex[];
  return { address: token, topics, data: encodeAbiParameters([{ type: "uint256" }], [value]) };
}

export const txHash = (n: number) => pad(`0x${n.toString(16)}`, { size: 32 }) as Hex;

// ── Fake venues ─────────────────────────────────────────────────────────

/** A venue that prices every pair it knows with a fixed out-per-in function. */
export class FakeVenue implements VenueAdapter {
  calls: QuoteParams[] = [];
  constructor(
    readonly venue: "uniswap_v3" | "textile_rfq",
    public pairs: Record<string, (amountIn: bigint) => bigint>,
  ) {}
  async quote(p: QuoteParams): Promise<Quote | null> {
    this.calls.push(p);
    const f = this.pairs[`${sym(p.tokenIn)}>${sym(p.tokenOut)}`];
    if (!f) return null;
    const out = f(p.amountIn);
    return {
      venue: this.venue,
      tokenIn: p.tokenIn,
      tokenOut: p.tokenOut,
      amountIn: p.amountIn,
      amountOut: out,
      blockNumber: p.blockNumber,
      firm: false,
      raw: { fake: true },
      ...(this.venue === "uniswap_v3" ? { meta: { pool: "0x5D8ef8B839be522b9E3d60a51EDB5837CD0b2391" as Address, fee: 100 } } : {}),
    };
  }
}

const sym = (a: string) => Object.values(TOKENS).find((t) => t.address.toLowerCase() === a.toLowerCase())!.symbol;

/** USDT (6) → wARS (18) at `rate` wARS per USDT. */
export const usdtToWars = (rate: bigint) => (a: bigint) => a * rate * 10n ** 12n;
export const warsToUsdt = (rate: bigint) => (a: bigint) => a / 10n ** 12n / rate;

// ── Fake Textile ────────────────────────────────────────────────────────

export class FakeTextile implements TextileTaker {
  hasPartnerKey = false;
  requests: Parameters<TextileTaker["request"]>[0][] = [];
  submits: { rfqId: string; claim: string; hash: Hex }[] = [];
  cancels: string[] = [];
  statusCalls = 0;
  submitError: Error | undefined;
  firm: (p: Parameters<TextileTaker["request"]>[0]) => TextileFirm = (p) => firmQuote(p.taker, p.sellAmount, p.sellAmount * 1600n * 10n ** 12n);

  async request(p: Parameters<TextileTaker["request"]>[0]) {
    this.requests.push(p);
    return this.firm(p);
  }
  async submit(rfqId: string, claim: string, hash: Hex) {
    this.submits.push({ rfqId, claim, hash });
    if (this.submitError) throw this.submitError;
    return { rfqId, status: "submitted" };
  }
  async status(rfqId: string) {
    this.statusCalls++;
    return { rfqId, status: "filled" };
  }
  async cancel(rfqId: string) {
    this.cancels.push(rfqId);
  }
}

export const REACTOR = CONTRACTS.textile.limitOrderReactor as Address;
export const SWAP_DATA = "0x0d7a16c3000000000000000000000000000000000000000000000000000000000000beef" as Hex;

export function firmQuote(taker: Address, sellAmount: bigint, buyAmount: bigint, ttlMs = 55_000, now = T0): TextileFirm {
  return {
    rfqId: "rfq-1",
    claimToken: CLAIM,
    status: "quoted",
    quote: {
      sellAmount: sellAmount.toString(),
      buyAmount: buyAmount.toString(),
      feeAmount: "0",
      takerPays: sellAmount.toString(),
      rateRay: "1",
      expiresAt: new Date(now + ttlMs).toISOString(),
      orderDeadline: new Date(now + 120_000).toISOString(),
      reactor: REACTOR,
      spender: REACTOR,
      taker,
      orders: [],
    },
    transactions: { swap: { to: REACTOR, data: SWAP_DATA, value: "0", chainId: 42220 } },
  };
}

// ── Fake LLM ────────────────────────────────────────────────────────────

/** Replies in order (the last repeats); records every request. */
export class ScriptedLlm implements LlmClient {
  requests: LlmChatRequest[] = [];
  private i = 0;
  constructor(private readonly replies: { content?: string; toolCalls?: { name: string; args: unknown }[] }[]) {}
  async chat(req: LlmChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    const r = this.replies[Math.min(this.i++, this.replies.length - 1)]!;
    const tool_calls = r.toolCalls?.map((c, k) => ({ id: `call_${this.i}_${k}`, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } }));
    return {
      message: { role: "assistant", content: r.content ?? null, ...(tool_calls ? { tool_calls } : {}) },
      toolCalls: tool_calls ?? [],
      finishReason: tool_calls ? "tool_calls" : "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: "fake-model",
    } as ChatResult;
  }
}

// ── Deps ────────────────────────────────────────────────────────────────

export interface TestRig {
  deps: MiniappDeps;
  store: MemoryStore;
  chain: FakeChain;
  uni: FakeVenue;
  textileVenue: FakeVenue;
  textile: FakeTextile;
  clock: { now: number };
  anchors: string[];
  llm: ScriptedLlm;
  transcripts: { bytes: number; mimeType: string }[];
}

export function makeRig(over: Partial<MiniappDeps> = {}): TestRig {
  const store = new MemoryStore();
  const chain = new FakeChain();
  const uni = new FakeVenue("uniswap_v3", {
    "USDT>wARS": usdtToWars(1600n),
    "wARS>USDT": warsToUsdt(1600n),
    "USDT>wBRL": (a) => a * 5n * 10n ** 12n,
    "wBRL>USDT": (a) => a / 10n ** 12n / 5n,
  });
  const textileVenue = new FakeVenue("textile_rfq", {});
  const textile = new FakeTextile();
  const clock = { now: T0 };
  const anchors: string[] = [];
  const llm = new ScriptedLlm([{ content: "Hola" }]);
  const transcripts: { bytes: number; mimeType: string }[] = [];
  const deps: MiniappDeps = {
    store: () => store,
    chain: chain.client(),
    chainId: 42220,
    adapters: [uni, textileVenue],
    references: async () => ({
      references: [{ name: "official", pair: "USD/ARS", rate: "1500", source: "test", at: new Date(T0).toISOString() }],
      unavailable: [],
    }),
    textile,
    textileEnabled: true,
    attributionCode: CODE,
    baseUrl: "https://arbolito.test",
    guard: undefined,
    anchor: undefined,
    verify: async () => ({ ok: true, errors: [] }),
    llm: () => llm,
    agentModel: "fake-model",
    transcribe: async (audio, opts) => {
      transcripts.push({ bytes: audio.byteLength, mimeType: opts.mimeType });
      return { text: "cambiá 10 dólares a pesos" };
    },
    limiter: new RateLimiter(() => clock.now),
    now: () => clock.now,
    ...over,
  };
  return { deps, store, chain, uni, textileVenue, textile, clock, anchors, llm, transcripts };
}

/** Records the prepared calls as mined txs from `from` (optionally tampering), returning their hashes. */
export function mineCalls(
  rig: TestRig,
  calls: { to: string; data: string }[],
  opts: { from?: Address; tamper?: (i: number, tx: FakeTx) => FakeTx; delivered?: { token: Address; amount: bigint } } = {},
): Hex[] {
  return calls.map((c, i) => {
    const hash = txHash(1000 + i + Math.floor(Math.random() * 1e6));
    const last = i === calls.length - 1;
    let tx: FakeTx = {
      from: opts.from ?? ACCOUNT,
      to: c.to as Address,
      input: c.data as Hex,
      logs: last && opts.delivered ? [transferLog(opts.delivered.token, REACTOR, ACCOUNT, opts.delivered.amount)] : [],
    };
    if (opts.tamper) tx = opts.tamper(i, tx);
    rig.chain.setTx(hash, tx);
    return hash;
  });
}
