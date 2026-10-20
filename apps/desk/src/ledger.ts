/**
 * The desk's ledger in Postgres: fills (indexed from chain) and inventory snapshots. Runs inside
 * the feed service's tick, so a fill is recorded with the fair price of the moment it was seen.
 * Reads the chain and writes our own database only; never sends a transaction.
 */
import { desc, eq } from "drizzle-orm";
import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { TOKENS } from "@arbolito/config";
import { deskFills, deskRfqs, deskSnapshots, deskState, type Db } from "@arbolito/db";
import type { Corridor } from "./corridors";
import { edgeBps, fillsFromTransfers, navMicros, type DeskTransfer } from "./fills";
import type { Balances } from "./inventory";

/** Desk funded at block ~80,172,000 (2026-10-15); nothing to index before it. */
export const DESK_START_BLOCK = 80_170_000n;
const CURSOR = "fills_cursor";
const MAX_RANGE = 2_000n;
/** Only blocks this deep are scanned, so a reorg can't hide a fill. */
const CONFIRMATIONS = 2n;
/** A fill seen within this long of its block gets the current fair price; older ones are backfill. */
const FRESH_MS = 5 * 60_000;
const SNAPSHOT_EVERY_MS = 5 * 60_000;

const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export interface FairNow {
  /** USDT per soft unit, by pair. */
  [pair: string]: number | undefined;
}

export class DeskLedger {
  private lastSnapshot = 0;
  /** Fills seen by this process, for the risk officer's window. */
  private recent: { pair: string; at: number; edgeBps?: number }[] = [];

  constructor(
    private db: Db,
    private client: PublicClient,
    private desk: Address,
    private corridors: readonly Corridor[],
    private log: (line: string) => void = () => {},
  ) {}

  private async cursor(): Promise<bigint> {
    const [row] = await this.db.select().from(deskState).where(eq(deskState.key, CURSOR));
    return row ? BigInt((row.value as { block: string }).block) : DESK_START_BLOCK - 1n;
  }

  private async setCursor(block: bigint): Promise<void> {
    await this.db
      .insert(deskState)
      .values({ key: CURSOR, value: { block: block.toString() } })
      .onConflictDoUpdate({ target: deskState.key, set: { value: { block: block.toString() } } });
  }

  /** Scan the next block range for desk transfers; record any fills. Returns how many were new. */
  async indexFills(fair: FairNow, now = Date.now()): Promise<number> {
    const head = (await this.client.getBlockNumber()) - CONFIRMATIONS;
    const from = (await this.cursor()) + 1n;
    if (from > head) return 0;
    const to = from + MAX_RANGE - 1n < head ? from + MAX_RANGE - 1n : head;
    const tokens = [TOKENS.USDT, ...this.corridors.map((c) => TOKENS[c.soft])].map((t) => t.address as Address);
    const [outs, ins] = await Promise.all([
      this.client.getLogs({ address: tokens, event: transfer, args: { from: this.desk }, fromBlock: from, toBlock: to }),
      this.client.getLogs({ address: tokens, event: transfer, args: { to: this.desk }, fromBlock: from, toBlock: to }),
    ]);
    const transfers: DeskTransfer[] = [...outs, ...ins].map((l) => ({
      txHash: l.transactionHash!,
      blockNumber: l.blockNumber!,
      token: l.address,
      from: l.args.from!,
      to: l.args.to!,
      value: l.args.value!,
    }));
    const hashes = [...new Set(transfers.map((t) => t.txHash))];
    const txs = new Map<Hex, { from: Address; to: Address | null }>();
    for (const h of hashes) {
      const tx = await this.client.getTransaction({ hash: h });
      txs.set(h, { from: tx.from, to: tx.to });
    }
    const fills = fillsFromTransfers(this.desk, transfers, this.corridors, (h) => txs.get(h)?.from);
    let added = 0;
    for (const f of fills) {
      const block = await this.client.getBlock({ blockNumber: f.blockNumber });
      const at = new Date(Number(block.timestamp) * 1000);
      const fairPx = now - at.getTime() <= FRESH_MS ? fair[f.pair] : undefined;
      const rows = await this.db
        .insert(deskFills)
        .values({
          txHash: f.txHash,
          blockNumber: f.blockNumber,
          at,
          pair: f.pair,
          side: f.side,
          softAmount: f.softAmount.toString(),
          usdtAmount: f.usdtAmount.toString(),
          price: String(f.price),
          fairPrice: fairPx === undefined ? null : String(fairPx),
          edgeBps: fairPx === undefined ? null : String(edgeBps(f.side, f.price, fairPx)),
          taker: txs.get(f.txHash)!.from.toLowerCase(),
          settlement: (txs.get(f.txHash)!.to ?? "").toLowerCase(),
        })
        .onConflictDoNothing()
        .returning({ tx: deskFills.txHash });
      if (rows.length) {
        added++;
        this.recent.push({ pair: f.pair, at: at.getTime(), edgeBps: fairPx === undefined ? undefined : edgeBps(f.side, f.price, fairPx) });
        if (this.recent.length > 500) this.recent.shift();
        this.log(`fill ${f.pair} ${f.side} ${f.softAmount} soft for ${f.usdtAmount} USDT @ ${f.price}${fairPx ? ` (fair ${fairPx})` : ""} ${f.txHash}`);
      }
    }
    await this.setCursor(to);
    return added;
  }

  /** Record inventory + NAV at most every few minutes. */
  /** `quoting`: per pair, whether the corridor was live this tick (for the uptime on /desk). */
  async snapshot(b: Balances, fair: FairNow, now = Date.now(), quoting?: Record<string, boolean>): Promise<void> {
    if (now - this.lastSnapshot < SNAPSHOT_EVERY_MS) return;
    const [blockNumber, celo] = await Promise.all([this.client.getBlockNumber(), this.client.getBalance({ address: this.desk })]);
    const nav = navMicros(b, this.corridors, fair);
    await this.db.insert(deskSnapshots).values({
      at: new Date(now),
      blockNumber,
      usdt: b.USDT.toString(),
      wars: b.wARS.toString(),
      wbrl: b.wBRL.toString(),
      usdc: b.USDC.toString(),
      usat: b.USAT.toString(),
      celo: celo.toString(),
      fairWars: fair["wars-usdt"] === undefined ? null : String(fair["wars-usdt"]),
      fairWbrl: fair["wbrl-usdt"] === undefined ? null : String(fair["wbrl-usdt"]),
      fairs: Object.fromEntries(Object.entries(fair).filter(([, v]) => v !== undefined)),
      balances: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.toString()])),
      navMicros: nav === undefined ? null : nav.toString(),
      quoting: quoting ?? null,
    });
    this.lastSnapshot = now;
  }

  /** An RFQ outcome from Stitch's log (once per RFQ id). */
  async recordRfqResult(rfqId: string, result: string, at = Date.now()): Promise<void> {
    await this.db.insert(deskRfqs).values({ rfqId, result, at: new Date(at) }).onConflictDoNothing({ target: deskRfqs.rfqId });
  }

  /** Fills seen in the last windowMs, by pair. */
  recentFills(windowMs: number, now = Date.now()) {
    return this.recent.filter((f) => now - f.at <= windowMs);
  }

  async latestSnapshot() {
    const [row] = await this.db.select().from(deskSnapshots).orderBy(desc(deskSnapshots.at)).limit(1);
    return row;
  }
}

