/**
 * The rebalancer (runs inside desk-feed): sells soft inventory above a corridor's cap back to USDT
 * (rebalance.ts decides the slice). Modes: "off", "dry" (quote and log only), "live" (Celo mainnet,
 * founder-approved 2026-10-19), "fork" (an anvil rehearsal).
 *
 * Money safety:
 * - Every sale goes through executeRoute → sendGuarded: simulated first, ERC-8021 tagged, charged to
 *   the per-action and daily caps (a database ledger on Railway).
 * - The route must pay at least the slice's floor (fair minus a few bps); otherwise the desk holds.
 * - A Textile route only once the corridor's buy side has been off for a while, so our own maker
 *   (whose buy side is then off) can't be the one filling it: no self-trading.
 * - A sale that doesn't complete stops the rebalancer until a restart. Nothing is retried.
 */
import type { Address, LocalAccount, PublicClient, WalletClient } from "viem";
import { TOKENS } from "@arbolito/config";
import type { SpendLedger } from "@arbolito/chain";
import { TextileClient, TextileRfqAdapter, UniswapV3Adapter, executableRoutes, executeRoute, plan, type VenueAdapter } from "@arbolito/router";
import type { Corridor } from "./corridors";
import type { Balances } from "./inventory";
import { REBALANCE, nextSlice, type SellSlice } from "./rebalance";

export type RebalanceMode = "off" | "dry" | "live" | "fork";

export interface RebalancerOptions {
  mode: RebalanceMode;
  publicClient: PublicClient;
  /** The desk wallet (signs swaps and Textile taker proofs). */
  account: LocalAccount;
  walletClient: WalletClient;
  ledger?: SpendLedger;
  /** Textile firm quotes enabled (TEXTILE_RFQ_ENABLED). */
  textileFirm: boolean;
  /** Gas token (Celo fee abstraction), e.g. "USDT": the desk holds USDT, not CELO. Mainnet only. */
  feeCurrency?: string;
  log: (line: string) => void;
  now?: () => number;
}

export interface RebalanceEvent {
  at: string;
  pair: string;
  action: "sold" | "would-sell" | "held" | "failed";
  softAmount: string;
  usdtOut?: string;
  venue?: string;
  txHash?: string;
  note?: string;
}

const SLIPPAGE_BPS = 20;
const KEEP = 30;

export class Rebalancer {
  private lastSellAt = new Map<string, number>();
  private offSince = new Map<string, number>();
  private busy = false;
  private stopped: string | null = null;
  private events: RebalanceEvent[] = [];

  constructor(private readonly o: RebalancerOptions) {}

  private now() {
    return (this.o.now ?? Date.now)();
  }

  /** Tracks how long each corridor's buy side has been off (for the Textile self-trade guard). */
  observe(buyOff: ReadonlySet<string>): void {
    const now = this.now();
    for (const p of buyOff) if (!this.offSince.has(p)) this.offSince.set(p, now);
    for (const p of [...this.offSince.keys()]) if (!buyOff.has(p)) this.offSince.delete(p);
  }

  status() {
    return { mode: this.o.mode, stopped: this.stopped, busy: this.busy, recent: this.events.slice(-10) };
  }

  private record(e: Omit<RebalanceEvent, "at">) {
    this.events.push({ at: new Date(this.now()).toISOString(), ...e });
    if (this.events.length > KEEP) this.events.splice(0, this.events.length - KEEP);
  }

  /** One decision: maybe sell one slice. Never overlaps itself; never throws. */
  async maybeSell(b: Balances, corridors: readonly Corridor[], usdtPerSoft: Record<string, number | undefined>, buyOff: ReadonlySet<string>): Promise<SellSlice | null> {
    if (this.o.mode === "off" || this.busy || this.stopped) return null;
    const slice = nextSlice(b, corridors, usdtPerSoft, buyOff, this.lastSellAt, this.now());
    if (!slice) return null;
    this.busy = true;
    this.lastSellAt.set(slice.pair, this.now()); // the cooldown also spaces out holds and failures
    try {
      await this.sell(slice);
    } catch (e) {
      this.stop(slice, `unexpected: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
    return slice;
  }

  private stop(slice: SellSlice, why: string) {
    this.stopped = `${slice.pair}: ${why}`;
    this.o.log(`rebalance STOPPED (${this.stopped}); check the desk wallet onchain, then restart`);
    this.record({ pair: slice.pair, action: "failed", softAmount: slice.amount.toString(), note: why });
  }

  private async sell(slice: SellSlice) {
    const { publicClient, account, log } = this.o;
    const soft = TOKENS[slice.soft];
    const offFor = this.now() - (this.offSince.get(slice.pair) ?? this.now());
    const textileOk = this.o.textileFirm && offFor >= REBALANCE.textileAfterOffMs;
    const adapters: VenueAdapter[] = [new UniswapV3Adapter(publicClient), ...(textileOk ? [new TextileRfqAdapter(undefined, undefined, 6_000)] : [])];
    const planned = await plan({
      client: publicClient,
      adapters,
      tokenIn: soft.address as Address,
      tokenOut: TOKENS.USDT.address as Address,
      amountIn: slice.amount,
      taker: account.address,
      slippageBps: SLIPPAGE_BPS,
    });
    const routes = executableRoutes(planned, { textileFirm: textileOk });
    const amt = `${(Number(slice.amount) / 10 ** soft.decimals).toFixed(2)} ${slice.soft}`;
    const route = routes.find((r) => r.minOut >= slice.minUsdtOut);
    if (!route) {
      const best = routes[0];
      const atFair = Number(slice.minUsdtOut) / (1 - slice.maxUnderFairBps / 10_000);
      const under = best ? Math.round((1 - Number(best.expectedOut) / atFair) * 10_000) : null;
      const worst = best ? Math.round((1 - Number(best.minOut) / atFair) * 10_000) : null;
      const note = best ? `best ${best.label} pays ${under} bps under fair, ${worst} bps at worst with slippage (limit ${slice.maxUnderFairBps})` : "no executable route";
      log(`rebalance ${slice.pair}: hold ${amt} (${note})`);
      this.record({ pair: slice.pair, action: "held", softAmount: slice.amount.toString(), note });
      return;
    }
    const venue = route.legs.map((l) => l.quote.venue).join("+");
    if (this.o.mode === "dry") {
      log(`rebalance ${slice.pair}: would sell ${amt} ≈ US$ ${slice.usd.toFixed(2)} via ${route.label} for ≥ ${Number(route.minOut) / 1e6} USDT`);
      this.record({ pair: slice.pair, action: "would-sell", softAmount: slice.amount.toString(), usdtOut: route.expectedOut.toString(), venue });
      return;
    }
    log(`rebalance ${slice.pair}: selling ${amt} ≈ US$ ${slice.usd.toFixed(2)} via ${route.label} (min ${Number(route.minOut) / 1e6} USDT)`);
    const res = await executeRoute({
      route,
      taker: account.address,
      account,
      publicClient,
      walletClient: this.o.walletClient,
      mode: this.o.mode === "fork" ? "fork" : "live",
      live: this.o.mode === "live",
      ledger: this.o.ledger,
      textile: route.legs.some((l) => l.quote.venue === "textile_rfq") ? new TextileClient() : undefined,
      usdValue: BigInt(Math.round(slice.usd * 1e6)),
      ...(this.o.mode === "live" && this.o.feeCurrency ? { feeCurrency: this.o.feeCurrency } : {}),
      onProgress: (e) => log(`  [${e.venue}] ${e.stage}: ${e.message}${e.txHash ? ` ${e.txHash}` : ""}`),
    });
    for (const w of res.warnings) log(`  warning: ${w}`);
    const txHash = res.txs.at(-1)?.hash;
    if (res.status !== "complete") return this.stop(slice, `${res.status}: ${res.error?.message ?? "unknown"}${txHash ? ` (last tx ${txHash})` : ""}`);
    log(`rebalance ${slice.pair}: sold ${amt} for ${Number(res.finalAmountOut) / 1e6} USDT`);
    this.record({ pair: slice.pair, action: "sold", softAmount: slice.amount.toString(), usdtOut: res.finalAmountOut.toString(), venue, txHash });
  }
}
