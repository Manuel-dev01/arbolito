import { bundleHash } from "@arbolito/proof";
import type { ReceiptRecord } from "./data";
import { medianBigint } from "./format";
import { tokenRef, usdNotionalMicros, type TokenRef } from "./receipt-view";

/**
 * /metrics v0, computed from receipts (see "Metric definitions" in docs/02-product-spec.md).
 * Superseded receipts are listed for transparency but never counted.
 */

export interface MetricsReceipt {
  id: string;
  routeId: string;
  createdAt: string;
  taker: string;
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  amountIn: bigint;
  amountOut: bigint;
  usdMicros?: bigint;
  savings?: { pair: string; bps: number; delta: bigint };
  bundleHash: string;
  executionTx: string;
  anchorTx: string | null;
}

export interface Metrics {
  receipts: MetricsReceipt[];
  superseded: { id: string; supersededBy: string | null; executionTx: string }[];
  wallets: { address: string; receiptIds: string[] }[];
  executionTxs: string[];
  anchorTxs: string[];
  /** wFIAT legs (wARS/wBRL/wCOP/…) by token: amount in atomic units and USD at execution. */
  volumeByToken: { token: TokenRef; amount: bigint; usdMicros: bigint; receiptIds: string[] }[];
  /** Fiat corridors, each route counted once at its USD notional. */
  corridors: { from: string; to: string; count: number; usdMicros: bigint; receiptIds: string[] }[];
  totalUsdMicros: bigint;
  /** Savings vs official, ARS corridor only. */
  savingsArs: { medianBps?: number; totalDelta: bigint; decimals: number; receiptIds: string[] };
}

const isWfiat = (t: TokenRef) => /^w[A-Z]{3}$/.test(t.symbol);

export function toMetricsReceipt(rec: ReceiptRecord, anchorTx: string | null = rec.anchorTx): MetricsReceipt {
  const b = rec.bundle;
  const s = b.savings;
  return {
    id: rec.id,
    routeId: b.routeId,
    createdAt: b.createdAt,
    taker: b.request.taker,
    tokenIn: tokenRef(b.request.tokenIn),
    tokenOut: tokenRef(b.request.tokenOut),
    amountIn: BigInt(b.request.amountIn),
    amountOut: BigInt(b.execution.amountOut),
    usdMicros: rec.usdMicros != null ? BigInt(rec.usdMicros) : usdNotionalMicros(b),
    savings: s ? { pair: s.pair, bps: s.bps, delta: BigInt(s.delta) } : undefined,
    bundleHash: bundleHash(b),
    executionTx: b.execution.txHash,
    anchorTx,
  };
}

export function computeMetrics(records: ReceiptRecord[], anchors: Map<string, string | null> = new Map()): Metrics {
  const active = records.filter((r) => !r.supersededBy);
  const receipts = active.map((r) => toMetricsReceipt(r, anchors.get(r.id) ?? r.anchorTx));

  const wallets = new Map<string, { address: string; receiptIds: string[] }>();
  const volume = new Map<string, Metrics["volumeByToken"][number]>();
  const corridors = new Map<string, Metrics["corridors"][number]>();
  const arsBps: bigint[] = [];
  const arsIds: string[] = [];
  let arsDelta = 0n;
  let arsDecimals = 18;
  let totalUsd = 0n;

  for (const r of receipts) {
    const key = r.taker.toLowerCase();
    const w = wallets.get(key) ?? { address: r.taker, receiptIds: [] };
    w.receiptIds.push(r.id);
    wallets.set(key, w);

    const usd = r.usdMicros ?? 0n;
    totalUsd += usd;
    for (const [token, amount] of [
      [r.tokenIn, r.amountIn],
      [r.tokenOut, r.amountOut],
    ] as const) {
      if (!isWfiat(token)) continue;
      const v = volume.get(token.symbol) ?? { token, amount: 0n, usdMicros: 0n, receiptIds: [] };
      v.amount += amount;
      v.usdMicros += usd;
      if (!v.receiptIds.includes(r.id)) v.receiptIds.push(r.id);
      volume.set(token.symbol, v);
    }

    const ck = `${r.tokenIn.fiat}>${r.tokenOut.fiat}`;
    const c = corridors.get(ck) ?? { from: r.tokenIn.fiat, to: r.tokenOut.fiat, count: 0, usdMicros: 0n, receiptIds: [] };
    c.count += 1;
    c.usdMicros += usd;
    c.receiptIds.push(r.id);
    corridors.set(ck, c);

    if (r.savings && r.savings.pair.endsWith("/ARS")) {
      arsBps.push(BigInt(r.savings.bps));
      arsDelta += r.savings.delta;
      arsDecimals = r.tokenOut.decimals;
      arsIds.push(r.id);
    }
  }

  const median = medianBigint(arsBps);
  return {
    receipts,
    superseded: records
      .filter((r) => r.supersededBy)
      .map((r) => ({ id: r.id, supersededBy: r.supersededBy, executionTx: r.bundle.execution.txHash })),
    wallets: [...wallets.values()],
    executionTxs: [...new Set(receipts.map((r) => r.executionTx))],
    anchorTxs: [...new Set(receipts.map((r) => r.anchorTx).filter((x): x is string => !!x))],
    volumeByToken: [...volume.values()].sort((a, b) => (a.usdMicros < b.usdMicros ? 1 : -1)),
    corridors: [...corridors.values()].sort((a, b) => (a.usdMicros < b.usdMicros ? 1 : -1)),
    totalUsdMicros: totalUsd,
    savingsArs: { medianBps: median === undefined ? undefined : Number(median), totalDelta: arsDelta, decimals: arsDecimals, receiptIds: arsIds },
  };
}
