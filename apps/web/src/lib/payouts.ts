import type { ReceiptRecord } from "./data";
import { buildReceiptView, type ReceiptView, type TokenRef } from "./receipt-view";

export interface StatementRow {
  id: string;
  recipient: string;
  view: ReceiptView;
  deliveryTx: string | null;
  anchorTx: string | null;
}

export interface Statement {
  payer: string;
  rows: StatementRow[];
  from: string;
  to: string;
  /** What was paid and received, per token. */
  paid: { token: TokenRef; amount: bigint }[];
  received: { token: TokenRef; amount: bigint; payees: number }[];
}

/**
 * Null unless every record is a delivered payment to someone else by one and the same payer: a
 * statement never mixes payers, and never lists a conversion the payer kept.
 */
export function buildStatement(records: readonly ReceiptRecord[]): Statement | null {
  const payer = records[0]?.bundle.request.taker.toLowerCase();
  if (!payer) return null;
  const rows: StatementRow[] = [];
  const paid = new Map<string, { token: TokenRef; amount: bigint }>();
  const received = new Map<string, { token: TokenRef; amount: bigint; to: Set<string> }>();
  for (const r of records) {
    const { request, execution } = r.bundle;
    const recipient = request.recipient?.toLowerCase();
    if (r.supersededBy || request.taker.toLowerCase() !== payer || !recipient || recipient === payer || BigInt(execution.amountOut) <= 0n) return null;
    const view = buildReceiptView(r.bundle);
    rows.push({ id: r.id, recipient, view, deliveryTx: execution.deliveryTxHash ?? null, anchorTx: r.anchorTx });
    const p = paid.get(view.tokenIn.address) ?? { token: view.tokenIn, amount: 0n };
    p.amount += view.amountIn;
    paid.set(view.tokenIn.address, p);
    const g = received.get(view.tokenOut.address) ?? { token: view.tokenOut, amount: 0n, to: new Set<string>() };
    g.amount += view.amountOut;
    g.to.add(recipient);
    received.set(view.tokenOut.address, g);
  }
  const dates = rows.map((r) => r.view.createdAt).sort();
  return {
    payer,
    rows,
    from: dates[0]!,
    to: dates.at(-1)!,
    paid: [...paid.values()],
    received: [...received.values()].map(({ token, amount, to }) => ({ token, amount, payees: to.size })),
  };
}
