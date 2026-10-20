/**
 * The desk feed service (long-running: the circuit breaker needs memory between ticks).
 *
 *   GET /feed/<pair>  → { price, timestamp } for Stitch (503 before the first healthy tick)
 *   GET /state        → per-corridor parameters, what is served, and the recent decisions
 *   GET /healthz      → { ok, lastTickAt }
 *
 * Reads only: public price sources and the desk wallet's balances. It holds no key and sends
 * nothing; Stitch does the quoting and signing.
 */
import { createServer, type Server } from "node:http";
import type { Address, PublicClient } from "viem";
import { CORRIDORS, validateCorridor, type Corridor } from "./corridors";
import { fairValue } from "./fair";
import { step, type Decision, type FeedState, type Published } from "./feed";
import { corridorShares, readBalances, type Balances } from "./inventory";
import type { DeskLedger, FairNow } from "./ledger";
import type { LlmClient } from "@arbolito/llm";
import { reviewRisk, windowStats, type CorridorSignals, type RiskDecision } from "./risk";
import { observeAll } from "./sources";

export interface FeedServiceOptions {
  client: PublicClient;
  port: number;
  deskAddress?: Address;
  corridors?: readonly Corridor[];
  tickMs?: number;
  log?: (line: string) => void;
  /** Records fills and inventory snapshots (needs deskAddress and a database). */
  ledger?: DeskLedger;
  /** LLM risk officer: may pause a corridor for 15–120 min, nothing else (risk.ts). */
  risk?: { llm: LlmClient; model: string; everyMs?: number };
  /** Called after every tick with the balances and fair prices (USDT per soft) it computed. */
  onTick?: (t: { balances?: Balances; usdtPerSoft: Record<string, number | undefined> }) => void;
  /** Extra fields merged into /state (e.g. the Stitch supervisor). */
  extraState?: () => Record<string, unknown>;
}

const HOUR = 3_600_000;

interface PairRuntime {
  state: FeedState;
  served?: Published;
  decisions: Decision[];
}

const KEEP = 120;

export class FeedService {
  readonly corridors: readonly Corridor[];
  private rt = new Map<string, PairRuntime>();
  private timer?: ReturnType<typeof setInterval>;
  private server?: Server;
  private lastTickAt?: string;
  private lastErrors: string[] = [];
  private balances?: Balances;
  private running = false;
  /** Last hour of healthy fair samples and breaker holds, per pair (for the risk officer). */
  private history = new Map<string, { samples: { at: number; fiatPerUsd: number }[]; holds: number[]; dispersionBps?: number; share?: number }>();
  /** Pauses set by the risk officer: until (ms) and why. */
  private pauses = new Map<string, { until: number; reason: string }>();
  private risk: { lastReviewAt?: string; lastError?: string; lastDecisions: RiskDecision[]; reviewing: boolean; nextAt: number } = { lastDecisions: [], reviewing: false, nextAt: 0 };

  constructor(private o: FeedServiceOptions) {
    this.corridors = o.corridors ?? CORRIDORS;
    const errs = this.corridors.flatMap(validateCorridor);
    if (errs.length) throw new Error(`unsafe corridor config:\n- ${errs.join("\n- ")}`);
    for (const c of this.corridors) this.rt.set(c.pair, { state: {}, decisions: [] });
  }

  /** One round: observe every source, compute fair, read inventory, step each corridor. */
  async tick(now = Date.now()): Promise<void> {
    if (this.running) return; // a slow round never overlaps the next
    this.running = true;
    const log = this.o.log ?? (() => {});
    try {
      const { byPair, errors } = await observeAll(this.o.client, this.corridors);
      const fairs = new Map(this.corridors.map((c) => [c.pair, fairValue(c, byPair.get(c.pair) ?? [], now)] as const));
      if (this.o.deskAddress) {
        try {
          this.balances = await readBalances(this.o.client, this.o.deskAddress);
        } catch (e) {
          errors.push(`balances: ${(e as Error).message}`);
        }
      }
      const fiat = new Map<string, number>();
      for (const [pair, f] of fairs) if (f.ok) fiat.set(pair, f.fiatPerUsd);
      const shares = this.balances ? corridorShares(this.balances, this.corridors, fiat) : new Map<string, number | undefined>();
      for (const c of this.corridors) {
        const r = this.rt.get(c.pair)!;
        const prevAction = r.decisions.at(-1)?.action;
        let fair = fairs.get(c.pair)!;
        const pause = this.pauses.get(c.pair);
        const paused = !!pause && now < pause.until;
        if (pause && !paused) this.pauses.delete(c.pair);
        else if (pause) fair = { ok: false, reason: `risk officer pause: ${pause.reason}`, used: fair.used, dropped: fair.dropped };
        const res = step(c, r.state, fair, shares.get(c.pair), now);
        const h = this.history.get(c.pair) ?? { samples: [], holds: [] };
        const raw = fairs.get(c.pair)!;
        if (raw.ok) {
          h.samples.push({ at: now, fiatPerUsd: raw.fiatPerUsd });
          h.dispersionBps = raw.dispersionBps;
        }
        // Only the breaker's own holds count. Holds caused by the officer's pause would read as an
        // unstable market and re-trigger the pause (it kept wBRL off for ~10 h on 2026-10-19).
        if (res.decision.action === "hold" && !paused) h.holds.push(now);
        h.samples = h.samples.filter((x) => now - x.at <= HOUR);
        h.holds = h.holds.filter((x) => now - x <= HOUR);
        h.share = shares.get(c.pair);
        this.history.set(c.pair, h);
        r.state = res.state;
        r.served = res.served;
        r.decisions.push(res.decision);
        if (r.decisions.length > KEEP) r.decisions.shift();
        const d = res.decision;
        if (d.action !== prevAction || d.action === "hold")
          log(`${c.pair} ${d.action}${d.reason ? ` (${d.reason})` : ""} fair=${d.fiatPerUsd?.toFixed(4) ?? "-"} skew=${d.skewBps ?? "-"}bps used=${d.used.join(",")}`);
      }
      if (this.o.ledger) {
        // The ledger never blocks or breaks the feed: its errors are reported, not thrown.
        const fairNow: FairNow = {};
        for (const [pair, f] of fiat) fairNow[pair] = 1 / f;
        try {
          await this.o.ledger.indexFills(fairNow, now);
          // Live = published this tick (not held by the breaker, not paused by the risk officer).
          const quoting = Object.fromEntries(this.corridors.map((c) => [c.pair, c.live && this.rt.get(c.pair)?.decisions.at(-1)?.action === "publish"]));
          if (this.balances) await this.o.ledger.snapshot(this.balances, fairNow, now, quoting);
        } catch (e) {
          errors.push(`ledger: ${(e as Error).message}`);
        }
      }
      if (this.o.risk && now >= this.risk.nextAt && !this.risk.reviewing) {
        this.risk.nextAt = now + (this.o.risk.everyMs ?? 15 * 60_000);
        void this.reviewRisk(now);
      }
      if (this.o.onTick) {
        const usdtPerSoft: Record<string, number | undefined> = {};
        for (const [pair, f] of fiat) usdtPerSoft[pair] = 1 / f;
        try {
          this.o.onTick({ balances: this.balances, usdtPerSoft });
        } catch (e) {
          errors.push(`onTick: ${(e as Error).message}`);
        }
      }
      this.lastErrors = errors;
      if (errors.length) log(`sources: ${errors.join("; ")}`);
      this.lastTickAt = new Date(now).toISOString();
    } finally {
      this.running = false;
    }
  }

  /** The signals the risk officer sees, per corridor. */
  riskSignals(now = Date.now()): CorridorSignals[] {
    const fills = this.o.ledger?.recentFills(HOUR, now) ?? [];
    return this.corridors.map((c) => {
      const h = this.history.get(c.pair);
      const mine = fills.filter((f) => f.pair === c.pair);
      const edges = mine.map((f) => f.edgeBps).filter((e): e is number => e !== undefined);
      const pause = this.pauses.get(c.pair);
      return {
        pair: c.pair,
        fairNow: h?.samples.at(-1)?.fiatPerUsd,
        ...windowStats(h?.samples ?? []),
        dispersionBps: h?.dispersionBps,
        breakerMaxDevBps: c.maxDevBps,
        holds: h?.holds.length ?? 0,
        share: h?.share === undefined ? undefined : Math.round(h.share * 1000) / 1000,
        fills: mine.length,
        avgEdgeBps: edges.length ? Math.round((edges.reduce((a, b) => a + b, 0) / edges.length) * 100) / 100 : undefined,
        paused: pause && now < pause.until ? pause.reason : undefined,
      };
    });
  }

  /** One risk review in the background; applies only bounded pauses (and lifts its own). */
  async reviewRisk(now = Date.now()): Promise<void> {
    if (!this.o.risk) return;
    this.risk.reviewing = true;
    try {
      const { decisions, error } = await reviewRisk(this.o.risk.llm, this.o.risk.model, this.riskSignals(now), this.corridors);
      this.risk.lastReviewAt = new Date(now).toISOString();
      this.risk.lastError = error;
      this.risk.lastDecisions = decisions;
      for (const d of decisions) {
        if (d.action === "pause") this.pauses.set(d.pair, { until: now + d.minutes * 60_000, reason: d.reason });
        else this.pauses.delete(d.pair); // "normal" lifts the officer's own pause; the breaker is separate
        if (d.action === "pause") this.o.log?.(`risk officer: pause ${d.pair} for ${d.minutes} min (${d.reason})`);
      }
      if (error) this.o.log?.(`risk officer: no decision (${error})`);
    } finally {
      this.risk.reviewing = false;
    }
  }

  served(pair: string): Published | undefined {
    return this.rt.get(pair)?.served;
  }

  state() {
    return {
      lastTickAt: this.lastTickAt ?? null,
      sourceErrors: this.lastErrors,
      ...(this.o.extraState?.() ?? {}),
      riskOfficer: this.o.risk
        ? { enabled: true, lastReviewAt: this.risk.lastReviewAt ?? null, lastError: this.risk.lastError ?? null, decisions: this.risk.lastDecisions, pauses: Object.fromEntries([...this.pauses].map(([k, v]) => [k, { until: new Date(v.until).toISOString(), reason: v.reason }])) }
        : { enabled: false },
      corridors: this.corridors.map((c) => {
        const r = this.rt.get(c.pair)!;
        return {
          pair: c.pair,
          params: { live: c.live, buyOffsetBps: c.buyOffsetBps, sellOffsetBps: c.sellOffsetBps, buyCapUsdt: c.buyCapUsdt.toString(), sellCapSoft: c.sellCapSoft.toString(), skew: c.skew },
          served: r.served ?? null,
          decisions: r.decisions.slice(-20),
        };
      }),
    };
  }

  async start(): Promise<void> {
    const tickMs = this.o.tickMs ?? 10_000;
    await this.tick();
    this.timer = setInterval(() => void this.tick().catch((e) => this.o.log?.(`tick failed: ${(e as Error).message}`)), tickMs);
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      const json = (code: number, body: unknown) => {
        res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(body));
      };
      const m = /^\/feed\/([a-z]+-[a-z]+)$/.exec(url.pathname);
      if (req.method === "GET" && m) {
        const served = this.served(m[1]!);
        return served ? json(200, served) : json(503, { error: "no healthy price yet" });
      }
      if (req.method === "GET" && url.pathname === "/state") return json(200, this.state());
      if (req.method === "GET" && url.pathname === "/healthz") return json(200, { ok: !!this.lastTickAt, lastTickAt: this.lastTickAt ?? null });
      json(404, { error: "not found" });
    });
    await new Promise<void>((resolve) => this.server!.listen(this.o.port, resolve));
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
