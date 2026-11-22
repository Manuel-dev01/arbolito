import { isOwnMaker } from "@arbolito/config";
import type { ReceiptRecord } from "./data";
import { tokenRef, usdNotionalMicros, type TokenRef } from "./receipt-view";

/**
 * Edition 2 (Agents Open for Business, Stablecoin Corridors) counts, from receipts alone, so every
 * number links to a receipt and its transaction. The track's rules, applied literally:
 * - only transactions tagged with the edition's code, executed from 20 Nov 2026;
 * - a conversion counts when it took a Textile firm quote as taker (Arbolito's own desk as maker
 *   doesn't count, nor does a team wallet as taker);
 * - payers and recipients count only outside the team (packages/config/src/team.ts + TEAM_WALLETS).
 * Everything left out is listed with its reason, so the exclusions are as checkable as the counts.
 */
export const EDITION2_CODE = "celo_0acfe36b6ea3";
export const EDITION2_SINCE = "2026-11-20T00:00:00.000Z";

export type Exclusion = "untagged" | "team_taker" | "own_desk_fill" | "not_textile";

export interface E2Conversion {
  id: string;
  createdAt: string;
  taker: string;
  recipient: string | null;
  tokenIn: TokenRef;
  tokenOut: TokenRef;
  amountIn: bigint;
  amountOut: bigint;
  usdMicros: bigint | undefined;
  executionTx: string;
  deliveryTx: string | null;
  /** The local-currency side ("NGN", "ARS", "BRL", …) or null for a dollar-to-dollar trade. */
  corridor: string | null;
}

export interface Edition2 {
  conversions: E2Conversion[];
  byCorridor: { corridor: string; count: number; usdMicros: bigint; local: { token: TokenRef; amount: bigint } | null; ids: string[] }[];
  payers: { address: string; ids: string[] }[];
  /** Payees outside the team who received local currency (a send's recipient). */
  recipients: { address: string; ids: string[] }[];
  repeatPayers: number;
  totalUsdMicros: bigint;
  excluded: { id: string; reason: Exclusion; executionTx: string }[];
}

type Firm = { kind?: string; quote?: { orders?: { maker?: string }[] } };

const isLocal = (t: TokenRef) => t.fiat !== "USD" && t.fiat !== "?";

export function computeEdition2(records: ReceiptRecord[], team: ReadonlySet<string>, since = EDITION2_SINCE): Edition2 {
  const out: Edition2 = { conversions: [], byCorridor: [], payers: [], recipients: [], repeatPayers: 0, totalUsdMicros: 0n, excluded: [] };
  const corridors = new Map<string, Edition2["byCorridor"][number]>();
  const payers = new Map<string, { address: string; ids: string[] }>();
  const recipients = new Map<string, { address: string; ids: string[] }>();

  for (const r of records) {
    const b = r.bundle;
    if (r.supersededBy || b.createdAt < since) continue;
    const exclude = (reason: Exclusion) => out.excluded.push({ id: r.id, reason, executionTx: b.execution.txHash });
    if (!b.execution.attribution.includes(EDITION2_CODE)) {
      exclude("untagged");
      continue;
    }
    const taker = b.request.taker.toLowerCase();
    if (team.has(taker)) {
      exclude("team_taker");
      continue;
    }
    const firms = b.chosen.legs.map((l) => l.quote).filter((q) => q.venue === "textile_rfq" && (q.raw as Firm | null)?.kind === "firm");
    if (!firms.length) {
      exclude("not_textile");
      continue;
    }
    if (firms.some((q) => ((q.raw as Firm).quote?.orders ?? []).some((o) => !!o.maker && isOwnMaker(o.maker)))) {
      exclude("own_desk_fill");
      continue;
    }

    const tokenIn = tokenRef(b.request.tokenIn);
    const tokenOut = tokenRef(b.request.tokenOut);
    const amountOut = BigInt(b.execution.amountOut);
    const usd = r.usdMicros != null ? BigInt(r.usdMicros) : usdNotionalMicros(b);
    const recipient = b.request.recipient ? b.request.recipient.toLowerCase() : null;
    const local = isLocal(tokenOut) ? tokenOut : isLocal(tokenIn) ? tokenIn : null;
    const c: E2Conversion = {
      id: r.id,
      createdAt: b.createdAt,
      taker,
      recipient,
      tokenIn,
      tokenOut,
      amountIn: BigInt(b.request.amountIn),
      amountOut,
      usdMicros: usd,
      executionTx: b.execution.txHash,
      deliveryTx: b.execution.deliveryTxHash ?? null,
      corridor: local?.fiat ?? null,
    };
    out.conversions.push(c);
    out.totalUsdMicros += usd ?? 0n;

    const key = c.corridor ?? "USD";
    const k = corridors.get(key) ?? { corridor: key, count: 0, usdMicros: 0n, local: local ? { token: local, amount: 0n } : null, ids: [] };
    k.count += 1;
    k.usdMicros += usd ?? 0n;
    if (k.local && local) k.local.amount += local === tokenOut ? amountOut : c.amountIn;
    k.ids.push(r.id);
    corridors.set(key, k);

    const p = payers.get(taker) ?? { address: taker, ids: [] };
    p.ids.push(r.id);
    payers.set(taker, p);
    if (recipient && recipient !== taker && !team.has(recipient) && isLocal(tokenOut)) {
      const q = recipients.get(recipient) ?? { address: recipient, ids: [] };
      q.ids.push(r.id);
      recipients.set(recipient, q);
    }
  }

  out.conversions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  out.byCorridor = [...corridors.values()].sort((a, b) => b.count - a.count);
  out.payers = [...payers.values()];
  out.recipients = [...recipients.values()];
  out.repeatPayers = out.payers.filter((p) => p.ids.length >= 2).length;
  return out;
}
