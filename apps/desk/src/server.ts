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
import { observeAll } from "./sources";

export interface FeedServiceOptions {
  client: PublicClient;
  port: number;
  deskAddress?: Address;
  corridors?: readonly Corridor[];
  tickMs?: number;
  log?: (line: string) => void;
}

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
        const res = step(c, r.state, fairs.get(c.pair)!, shares.get(c.pair), now);
        r.state = res.state;
        r.served = res.served;
        r.decisions.push(res.decision);
        if (r.decisions.length > KEEP) r.decisions.shift();
        const d = res.decision;
        if (d.action !== prevAction || d.action === "hold")
          log(`${c.pair} ${d.action}${d.reason ? ` (${d.reason})` : ""} fair=${d.fiatPerUsd?.toFixed(4) ?? "-"} skew=${d.skewBps ?? "-"}bps used=${d.used.join(",")}`);
      }
      this.lastErrors = errors;
      if (errors.length) log(`sources: ${errors.join("; ")}`);
      this.lastTickAt = new Date(now).toISOString();
    } finally {
      this.running = false;
    }
  }

  served(pair: string): Published | undefined {
    return this.rt.get(pair)?.served;
  }

  state() {
    return {
      lastTickAt: this.lastTickAt ?? null,
      sourceErrors: this.lastErrors,
      corridors: this.corridors.map((c) => {
        const r = this.rt.get(c.pair)!;
        return {
          pair: c.pair,
          params: { buyOffsetBps: c.buyOffsetBps, sellOffsetBps: c.sellOffsetBps, buyCapUsdt: c.buyCapUsdt.toString(), sellCapSoft: c.sellCapSoft.toString(), skew: c.skew },
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
