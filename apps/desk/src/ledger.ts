/**
 * The desk's ledger in Postgres: fills (indexed from chain) and inventory snapshots. Runs inside
 * the feed service's tick, so a fill is recorded with the fair price of the moment it was seen.
 * Reads the chain and writes our own database only; never sends a transaction.
 *
 * Database traffic is batched so the database can suspend between visits (Neon bills compute
 * while it is awake, and a query every 10 s kept it awake around the clock: the free quota ran out
 * on 2026-11-22). The scan cursor lives in memory and is saved with the snapshot and the buffered
 * RFQ results once every PERSIST_EVERY_MS. Fills are written the moment they are seen. A restart
 * rescans at most PERSIST_EVERY_MS of blocks, which is harmless: fill inserts are idempotent.
 */
import { desc, eq, gte } from "drizzle-orm";
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
/** Snapshots, the saved cursor and RFQ results all go to the database together, this often. */
export const PERSIST_EVERY_MS = 15 * 60_000;

const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export interface FairNow {
  /** USDT per soft unit, by pair. */
  [pair: string]: number | undefined;
}

export class DeskLedger {
  private lastSnapshot = 0;
  /** Fills seen by this process, for the risk officer's window. */
  private recent: { pair: string; at: number; edgeBps?: number }[] = [];
  /** Last block scanned (read from the database once, then kept here). */
  private scanned?: bigint;
  /** The block last saved to the database, and when. */
  private saved?: bigint;
  private savedAt = 0;
  /** RFQ results from Stitch's log, waiting for the next save. */
  private rfqs: { rfqId: string; result: string; at: Date }[] = [];

  constructor(
    private db: Db,
    private client: PublicClient,
    private desk: Address,
    private corridors: readonly Corridor[],
    private log: (line: string) => void = () => {},
  ) {}

  private async cursor(): Promise<bigint> {
    if (this.scanned === undefined) {
      const [row] = await this.db.select().from(deskState).where(eq(deskState.key, CURSOR));
      this.scanned = row ? BigInt((row.value as { block: string }).block) : DESK_START_BLOCK - 1n;
      this.saved = this.scanned;
    }
    return this.scanned;
  }

  private async setCursor(block: bigint): Promise<void> {
    await this.db
      .insert(deskState)
      .values({ key: CURSOR, value: { block: block.toString() } })
      .onConflictDoUpdate({ target: deskState.key, set: { value: { block: block.toString() } } });
    this.saved = block;
  }

  /**
   * Save the cursor and the buffered RFQ results when due (or when forced: after new fills, and on
   * shutdown). A failed write keeps them for the next try.
   */
  async persist(now = Date.now(), force = false): Promise<void> {
    if (!force && now - this.savedAt < PERSIST_EVERY_MS) return;
    // A forced save keeps the schedule, so routine saves stay on the same tick as the snapshot.
    if (!force) this.savedAt = now;
    if (this.scanned !== undefined && this.scanned !== this.saved) await this.setCursor(this.scanned);
    if (this.rfqs.length) {
      const batch = this.rfqs;
      this.rfqs = [];
      try {
        await this.db.insert(deskRfqs).values(batch).onConflictDoNothing({ target: deskRfqs.rfqId });
      } catch (e) {
        this.rfqs = [...batch, ...this.rfqs].slice(-2_000);
        throw e;
      }
    }
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
    this.scanned = to;
    // New fills are rare and worth keeping across a restart: save the cursor with them.
    await this.persist(now, added > 0);
    return added;
  }

  /** Record inventory + NAV every PERSIST_EVERY_MS. */
  /** `quoting`: per pair, whether the corridor was live this tick (for the uptime on /desk). */
  async snapshot(b: Balances, fair: FairNow, now = Date.now(), quoting?: Record<string, boolean>): Promise<void> {
    if (now - this.lastSnapshot < PERSIST_EVERY_MS) return;
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

  /** An RFQ outcome from Stitch's log (once per RFQ id), saved with the next persist. */
  recordRfqResult(rfqId: string, result: string, at = Date.now()): void {
    if (this.rfqs.some((r) => r.rfqId === rfqId)) return;
    this.rfqs.push({ rfqId, result, at: new Date(at) });
  }

  /** Fills seen in the last windowMs, by pair. */
  recentFills(windowMs: number, now = Date.now()) {
    return this.recent.filter((f) => now - f.at <= windowMs);
  }

  /** Fair prices from the snapshots of the last windowMs, as fiat per USD by pair (for the carry estimate). */
  async fairHistory(windowMs: number, now = Date.now()): Promise<Map<string, { at: number; fiatPerUsd: number }[]>> {
    const rows = await this.db
      .select({ at: deskSnapshots.at, fairs: deskSnapshots.fairs })
      .from(deskSnapshots)
      .where(gte(deskSnapshots.at, new Date(now - windowMs)));
    const out = new Map<string, { at: number; fiatPerUsd: number }[]>();
    for (const r of rows) {
      for (const [pair, usdtPerSoft] of Object.entries((r.fairs ?? {}) as Record<string, number | string | null>)) {
        const v = Number(usdtPerSoft);
        if (!(v > 0)) continue;
        (out.get(pair) ?? out.set(pair, []).get(pair)!).push({ at: r.at.getTime(), fiatPerUsd: 1 / v });
      }
    }
    return out;
  }

  async latestSnapshot() {
    const [row] = await this.db.select().from(deskSnapshots).orderBy(desc(deskSnapshots.at)).limit(1);
    return row;
  }
}

