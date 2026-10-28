/**
 * The rules runner: executes active rules through ArbolitoGuard v2 with Arbolito's operator key.
 * Runs inside the long-lived bot service (apps/agent), every minute.
 *
 * Money safety:
 * - The guard is the hard boundary: it only pays the account itself (swaps) or contacts the
 *   account allowlisted onchain, within the account's per-transaction and daily caps, at no
 *   worse than its TWAP floor. The operator can't change any of that.
 * - A run is claimed in the database before anything is sent; (rule, trigger) is unique, so a
 *   month or an incoming payment is executed at most once, even across crashes and restarts.
 * - Every transaction goes through sendGuarded: simulated first, ERC-8021 tagged, and charged
 *   to Arbolito's own build caps (≤ US$ 5 per action, ≤ US$ 25 per day) on top of the user's.
 * - Nothing is retried. A failure before broadcast skips this run; an unconfirmed broadcast
 *   stops the rule until a human checks it.
 */
import { parseAbiItem, type Address, type Hex, type LocalAccount, type PublicClient, type WalletClient } from "viem";
import { POOLS, TOKENS } from "@arbolito/config";
import {
  BroadcastError,
  capsFromEnv,
  encodeGuardV2SendFor,
  encodeGuardV2SwapFor,
  encodeV3Path,
  readGuardV2Budget,
  readGuardV2IsContact,
  readGuardV2MinOutFloor,
  readGuardV2Operator,
  readGuardV2Settings,
  sendGuarded,
  type SpendLedger,
} from "@arbolito/chain";
import { UniswapV3Adapter, erc20Abi, receivedInTx } from "@arbolito/router";
import { describeRule, nextMonthlyRun, parseRule, sendTrigger, splitTrigger, usd, type Lang, type RuleSpec, type RuleSym, type SendParams, type SplitParams } from "./index";

/** The storage the runner needs (the database in production, memory in tests). */
export interface RunnerStore {
  dueSendRules(now: Date): Promise<StoredRule[]>;
  activeSplitRules(): Promise<StoredRule[]>;
  claimRun(ruleId: string, trigger: string, amountIn: bigint | null): Promise<{ id: string } | null>;
  finishRun(runId: string, r: { status: "done" | "limited" | "partial" | "failed" | "skipped"; amountOut?: bigint | null; txHashes: string[]; error?: string | null }): Promise<void>;
  setNextRun(ruleId: string, at: Date): Promise<void>;
  setCursor(ruleId: string, block: bigint): Promise<void>;
  stopRule(ruleId: string, reason: string): Promise<void>;
  /** The account's signed "Pause Arbolito" (off chain). Optional: absent means never paused. */
  isPaused?(account: string): Promise<boolean>;
}

export interface StoredRule {
  id: string;
  account: string;
  kind: string;
  params: unknown;
  lang: string;
  nextRunAt: Date | null;
  cursorBlock: bigint | null;
}

export interface RunnerOptions {
  store: RunnerStore;
  publicClient: PublicClient;
  operator: LocalAccount;
  walletClient: WalletClient;
  guard: Address;
  mode: "fork" | "live";
  /** Arbolito's spend ledger for the operator (caps across all users). */
  ledger?: SpendLedger;
  /** Tells the account what happened (Telegram when linked). Best effort. */
  notify?: (account: Address, text: string) => Promise<void>;
  log?: (line: string) => void;
  now?: () => Date;
  /** Slippage under the Uniswap quote; minOut never goes under the guard's floor. */
  slippageBps?: number;
  /** Blocks to wait before treating an incoming transfer as final. */
  confirmations?: bigint;
  /** Arbolito's own cap per operator transaction (micro-USD); defaults to the build caps sendGuarded enforces. */
  maxActionMicros?: bigint;
}

/** At most this many transactions per run, so a large rule over small limits stays cheap and bounded. */
export const MAX_CHUNKS_PER_RUN = 10;

/**
 * How one run will move money: `total` (what the account asked for, cut to what its limits, balance
 * and allowance allow today) in pieces of at most `chunk` (its per-transaction limit and Arbolito's
 * per-action cap). `limitedBy` says why `total` is under what was asked, when it is.
 */
interface Plan {
  want: bigint;
  total: bigint;
  chunk: bigint;
  limitedBy?: string;
}

const isPlan = (x: Outcome | Plan): x is Plan => "chunk" in x;

const USDT = TOKENS.USDT.address as Address;
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
/** forno answers getLogs over at most 5,000 blocks. */
const LOG_SPAN = 4_900n;

/** The guard-pinned pool fee between USDT and `sym`. */
function feeTo(sym: RuleSym): number {
  const t = TOKENS[sym].address.toLowerCase();
  const p = POOLS.find((x) => x.guard && [x.token0, x.token1].map((s) => TOKENS[s as RuleSym]?.address.toLowerCase()).includes(t));
  if (!p) throw new Error(`no guard pool for USDT/${sym}`);
  return p.fee;
}

/**
 * A transaction that didn't succeed: not sent (simulation refused it, nothing moved), reverted
 * (mined, nothing moved, gas spent) or unconfirmed (it may still land: the rule stops for a human).
 */
type Sent = { ok: true; hash: Hex; receipt: Parameters<typeof receivedInTx>[0] } | { ok: false; hash?: Hex; outcome: "not-sent" | "reverted" | "unconfirmed"; error: string };

function failed(sent: Extract<Sent, { ok: false }>, prior: Hex[] = []): Outcome {
  return {
    status: sent.outcome === "not-sent" ? "skipped" : "failed",
    txHashes: [...prior, ...(sent.hash ? [sent.hash] : [])],
    error: sent.error,
    ...(sent.outcome === "unconfirmed" ? { stop: `unconfirmed transaction ${sent.hash}; check it before turning the rule back on` } : {}),
  };
}

/**
 * done: all of it · limited: part of it, the rest stayed in the account (limits, balance, or a later
 * piece failed) · partial: changed but not sent · failed · skipped: nothing moved.
 */
type Outcome = { status: "done" | "limited" | "partial" | "failed" | "skipped"; amountIn?: bigint; amountOut?: bigint; txHashes: Hex[]; error?: string; stop?: string };

const MSG: Record<Lang, { done: string; limited: string; partial: string; skipped: string; failed: string; stopped: string }> = {
  es: { done: "Arbolito hizo tu regla", limited: "Arbolito hizo parte de tu regla, hasta tus límites (el resto quedó en tu cuenta)", partial: "Arbolito cambió pero no pudo enviar (la plata quedó en tu cuenta)", skipped: "Arbolito no pudo hacer tu regla esta vez", failed: "Falló tu regla; no se movió plata", stopped: "Arbolito pausó tu regla" },
  pt: { done: "O Arbolito fez a sua regra", limited: "O Arbolito fez parte da sua regra, até os seus limites (o resto ficou na sua conta)", partial: "O Arbolito trocou mas não conseguiu enviar (o dinheiro ficou na sua conta)", skipped: "O Arbolito não conseguiu fazer a sua regra desta vez", failed: "A sua regra falhou; nenhum dinheiro foi movido", stopped: "O Arbolito pausou a sua regra" },
  en: { done: "Arbolito ran your rule", limited: "Arbolito ran part of your rule, up to your limits (the rest stayed in your account)", partial: "Arbolito changed the money but couldn't send it (it stayed in your account)", skipped: "Arbolito couldn't run your rule this time", failed: "Your rule failed; no money moved", stopped: "Arbolito paused your rule" },
};

const usdtText = (micros: bigint) => `US$ ${(Number(micros) / 1e6).toFixed(2)}`;

export class RulesRunner {
  private busy = false;
  private readonly uni: UniswapV3Adapter;

  constructor(private readonly o: RunnerOptions) {
    this.uni = new UniswapV3Adapter(o.publicClient);
  }

  private now() {
    return (this.o.now ?? (() => new Date()))();
  }
  private log(line: string) {
    this.o.log?.(`[rules] ${line}`);
  }

  /** One pass: due sends, then new incoming payments for splits. Never overlaps itself; never throws. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const r of await this.o.store.dueSendRules(this.now())) await this.safely(r, () => this.runSend(r));
      for (const r of await this.o.store.activeSplitRules()) await this.safely(r, () => this.scanSplit(r));
    } catch (e) {
      this.log(`tick failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async safely(r: StoredRule, f: () => Promise<void>) {
    try {
      await f();
    } catch (e) {
      this.log(`rule ${r.id}: ${(e as Error).message}`);
    }
  }

  // ── sends ───────────────────────────────────────────────────────────────
  private async runSend(r: StoredRule) {
    const spec = parseRule(r.kind, r.params) as { kind: "send"; params: SendParams };
    const runAt = r.nextRunAt ?? this.now();
    const run = await this.o.store.claimRun(r.id, sendTrigger(runAt), BigInt(spec.params.amountUsdt));
    // Next month either way: a skipped or failed month is not retried.
    await this.o.store.setNextRun(r.id, nextMonthlyRun(spec.params.dayOfMonth, this.now()));
    if (!run) return; // this month already ran (or is running)
    const out = await this.executeSend(r.account as Address, spec.params).catch(beforeAnyTx);
    await this.finish(r, spec, run.id, out);
  }

  private async executeSend(account: Address, p: SendParams): Promise<Outcome> {
    const contact = p.contact as Address;
    const plan = await this.preflight(account, BigInt(p.amountUsdt), contact);
    if (!isPlan(plan)) return plan;
    return this.inChunks(plan, async (amount) => {
      if (p.receive === "USDT") {
        const sent = await this.send(encodeGuardV2SendFor(account, USDT, contact, amount), amount, `rule send US$ to ${contact}`);
        return sent.ok ? { status: "done", amountOut: amount, txHashes: [sent.hash] } : failed(sent);
      }
      const swap = await this.swap(account, p.receive, amount);
      if (swap.status !== "done") return swap;
      const token = TOKENS[p.receive].address as Address;
      const sent = await this.send(encodeGuardV2SendFor(account, token, contact, swap.amountOut!), amount, `rule send ${p.receive} to ${contact}`);
      if (sent.ok) return { status: "done", amountOut: swap.amountOut, txHashes: [...swap.txHashes, sent.hash] };
      // The swap landed but the payment didn't: the converted funds are in the account's own wallet.
      return { ...failed(sent, swap.txHashes), status: "partial", amountOut: swap.amountOut };
    });
  }

  /**
   * Runs a plan piece by piece (each piece one guarded swap or send, so each stays within the
   * per-transaction limit). Stops at the first piece that doesn't fully succeed and reports what
   * already landed: a rule is never all-or-nothing just because it's larger than one transaction.
   */
  private async inChunks(plan: Plan, step: (amount: bigint) => Promise<Outcome>): Promise<Outcome> {
    const hashes: Hex[] = [];
    let done = 0n;
    let out = 0n;
    while (done < plan.total) {
      const amount = plan.total - done < plan.chunk ? plan.total - done : plan.chunk;
      const r = await step(amount);
      hashes.push(...r.txHashes);
      if (r.status !== "done") {
        if (done === 0n) return { ...r, txHashes: hashes };
        const partial = r.status === "partial";
        return {
          status: partial ? "partial" : "limited",
          amountIn: done,
          amountOut: out + (partial ? (r.amountOut ?? 0n) : 0n),
          txHashes: hashes,
          error: `${usdtText(done)} of ${usdtText(plan.want)} done, then: ${r.error ?? r.status}`,
          ...(r.stop ? { stop: r.stop } : {}),
        };
      }
      done += amount;
      out += r.amountOut ?? 0n;
    }
    if (done < plan.want) return { status: "limited", amountIn: done, amountOut: out, txHashes: hashes, error: `${usdtText(done)} of ${usdtText(plan.want)}, capped by ${plan.limitedBy}` };
    return { status: "done", amountIn: done, amountOut: out, txHashes: hashes };
  }

  // ── splits ──────────────────────────────────────────────────────────────
  private async scanSplit(r: StoredRule) {
    const spec = parseRule(r.kind, r.params) as { kind: "split"; params: SplitParams };
    const latest = (await this.o.publicClient.getBlockNumber()) - (this.o.confirmations ?? 2n);
    if (r.cursorBlock === null) {
      await this.o.store.setCursor(r.id, latest); // only payments after the rule was turned on
      return;
    }
    const account = r.account as Address;
    for (let from = r.cursorBlock + 1n; from <= latest; from += LOG_SPAN) {
      const to = from + LOG_SPAN - 1n > latest ? latest : from + LOG_SPAN - 1n;
      const logs = await this.o.publicClient.getLogs({ address: USDT, event: TRANSFER, args: { to: account }, fromBlock: from, toBlock: to });
      for (const l of logs) {
        const value = l.args.value!;
        if (value < BigInt(spec.params.minIncomingUsdt)) continue;
        // Pay comes from someone else. The account's own conversions (sent by the account) and
        // anything through the guard don't count.
        const tx = await this.o.publicClient.getTransaction({ hash: l.transactionHash! });
        if (tx.from.toLowerCase() === account.toLowerCase() || tx.to?.toLowerCase() === this.o.guard.toLowerCase()) continue;
        const amountIn = (value * BigInt(spec.params.percent)) / 100n;
        const run = await this.o.store.claimRun(r.id, splitTrigger(l.transactionHash!, l.logIndex!), amountIn);
        if (!run) continue;
        const out = await this.preflight(account, amountIn)
          .then((plan) => (isPlan(plan) ? this.inChunks(plan, (amount) => this.swap(account, spec.params.to, amount)) : plan))
          .catch(beforeAnyTx);
        await this.finish(r, spec, run.id, out, value);
      }
      await this.o.store.setCursor(r.id, to);
    }
  }

  // ── building blocks ─────────────────────────────────────────────────────
  /**
   * Checks the guard and the wallet before spending gas: a "skipped" outcome, or the plan for the
   * run. A rule bigger than the per-transaction limit runs in pieces; one bigger than what's left
   * today (or than the balance or allowance) runs as far as that and says why it stopped there.
   */
  private async preflight(account: Address, want: bigint, contact?: Address): Promise<Outcome | Plan> {
    const { publicClient: c, guard, operator } = this.o;
    const [settings, op, budget, balance, allowance] = await Promise.all([
      readGuardV2Settings(c, guard, account),
      readGuardV2Operator(c, guard, account),
      readGuardV2Budget(c, guard, account, USDT),
      c.readContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      c.readContract({ address: USDT, abi: erc20Abi, functionName: "allowance", args: [account, guard] }),
    ]);
    const stop = (why: string): Outcome => ({ status: "skipped", txHashes: [], error: why, stop: why });
    if (!settings.configured) return stop("autonomy is not set up for this account");
    if (!op.active || op.operator.toLowerCase() !== operator.address.toLowerCase()) return stop("Arbolito's permission expired or was revoked");
    if (contact && !(await readGuardV2IsContact(c, guard, account, contact))) return stop("the contact is no longer allowed in the guard");
    const skip = (why: string): Outcome => ({ status: "skipped", txHashes: [], error: why });
    if (settings.paused || (await this.o.store.isPaused?.(account))) return skip("the account paused Arbolito");
    // One piece: the account's per-transaction limit, and never more than Arbolito's own per-action cap.
    const cap = this.o.maxActionMicros ?? capsFromEnv().maxActionMicros;
    const chunk = budget.maxPerTx < cap ? budget.maxPerTx : cap;
    if (chunk <= 0n) return skip("the per-transaction limit is zero");
    const dayLeft = budget.maxPerDay > budget.spentToday ? budget.maxPerDay - budget.spentToday : 0n;
    let total = want;
    let limitedBy: string | undefined;
    const cut = (to: bigint, why: string) => {
      if (to < total) {
        total = to;
        limitedBy = why;
      }
    };
    cut(dayLeft, `your daily limit (${usdtText(budget.maxPerDay)} a day)`);
    cut(balance, "the USDT in your account");
    cut(allowance, "the guard's allowance (renew the permission)");
    cut(chunk * BigInt(MAX_CHUNKS_PER_RUN), `${MAX_CHUNKS_PER_RUN} transactions per run`);
    if (total <= 0n) {
      if (dayLeft === 0n) return skip("today's limit is used up");
      if (balance === 0n) return skip("not enough USDT in the account");
      return skip("the guard's allowance ran out; renew the permission");
    }
    return { want, total, chunk, limitedBy };
  }

  private async swap(account: Address, to: RuleSym, amountIn: bigint): Promise<Outcome> {
    const token = TOKENS[to].address as Address;
    const path = encodeV3Path([USDT, token], [feeTo(to)]);
    const [floor, quote] = await Promise.all([
      readGuardV2MinOutFloor(this.o.publicClient, this.o.guard, account, path, amountIn),
      this.uni.quote({ tokenIn: USDT, tokenOut: token, amountIn, taker: account, blockNumber: await this.o.publicClient.getBlockNumber() }),
    ]);
    if (!quote) return { status: "skipped", txHashes: [], error: "no Uniswap quote" };
    const slip = BigInt(this.o.slippageBps ?? 50);
    const minOut = (quote.amountOut * (10_000n - slip)) / 10_000n > floor ? (quote.amountOut * (10_000n - slip)) / 10_000n : floor;
    if (minOut > quote.amountOut) return { status: "skipped", txHashes: [], error: "the market pays less than the guard's price floor right now" };
    const sent = await this.send(encodeGuardV2SwapFor(account, path, amountIn, minOut), amountIn, `rule swap USDT→${to}`);
    if (!sent.ok) return failed(sent);
    return { status: "done", amountOut: receivedInTx(sent.receipt!, token, account), txHashes: [sent.hash] };
  }

  /** One guarded operator transaction. */
  private async send(data: Hex, usdMicros: bigint, purpose: string): Promise<Sent> {
    try {
      const block = await this.o.publicClient.getBlock();
      const tip = await this.o.publicClient.estimateMaxPriorityFeePerGas();
      const base = block.baseFeePerGas ?? (await this.o.publicClient.getGasPrice());
      const res = await sendGuarded({
        mode: this.o.mode,
        live: this.o.mode === "live",
        publicClient: this.o.publicClient,
        walletClient: this.o.walletClient,
        to: this.o.guard,
        data,
        usdMicros,
        purpose,
        ledger: this.o.ledger,
        // A 1.25x base-fee cap keeps the operator's small CELO float enough for each send.
        fees: { maxFeePerGas: (base * 5n) / 4n + tip, maxPriorityFeePerGas: tip },
      });
      return { ok: true, hash: res.hash, receipt: res.receipt };
    } catch (e) {
      const err = e as Error & { shortMessage?: string };
      if (e instanceof BroadcastError) return { ok: false, hash: e.hash, outcome: e.outcome, error: err.message };
      return { ok: false, outcome: "not-sent", error: err.shortMessage ?? err.message };
    }
  }

  private async finish(r: StoredRule, spec: RuleSpec, runId: string, out: Outcome, incoming?: bigint) {
    await this.o.store.finishRun(runId, { status: out.status, amountOut: out.amountOut ?? null, txHashes: out.txHashes, error: out.error ?? null });
    if (out.stop) await this.o.store.stopRule(r.id, out.stop);
    const lang = (["es", "pt", "en"].includes(r.lang) ? r.lang : "es") as Lang;
    this.log(`rule ${r.id} (${r.kind}) → ${out.status}${out.error ? `: ${out.error}` : ""}${out.txHashes.length ? ` ${out.txHashes.join(" ")}` : ""}`);
    if (!this.o.notify) return;
    const m = MSG[lang];
    const head = out.stop ? m.stopped : out.status === "done" ? m.done : out.status === "limited" ? m.limited : out.status === "partial" ? m.partial : out.status === "skipped" ? m.skipped : m.failed;
    const lines = [`${head}: ${describeRule(spec, lang)}`];
    if (incoming !== undefined) lines.push(`(${usd(incoming, lang)} ${lang === "en" ? "arrived" : lang === "pt" ? "chegaram" : "llegaron"})`);
    if (out.error) lines.push(out.error);
    for (const h of out.txHashes) lines.push(`https://celoscan.io/tx/${h}`);
    await this.o.notify(r.account as Address, lines.join("\n")).catch(() => {});
  }
}

/**
 * A claimed run that threw (an RPC or database error in the reads before sending). send() never
 * throws, so nothing was broadcast: close the run as skipped and tell the user, rather than
 * leaving it "running" and the month (or the payday) silently missed.
 */
function beforeAnyTx(e: unknown): Outcome {
  return { status: "skipped", txHashes: [], error: `couldn't check the account just now (${((e as Error).message ?? String(e)).slice(0, 120)})` };
}
