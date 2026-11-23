import { isOwnMaker, isPublicTeamWallet } from "@arbolito/config";
import type { ReceiptRecord } from "./data";
import { tokenRef, usdNotionalMicros, type TokenRef } from "./receipt-view";

/**
 * Edition 2 (Agents Open for Business, Stablecoin Corridors) counts, from receipts alone, so every
 * number links to a receipt and its transaction. The track's rules, applied literally:
 * - only transactions tagged with the edition's code, executed from 20 Nov 2026;
 * - a conversion counts when it took a Textile firm quote as taker in a listed corridor (Arbolito's
 *   own desk as maker doesn't count, nor does a team wallet as taker);
 * - payers and payees count only outside the team (packages/config/src/team.ts + TEAM_WALLETS) and
 *   when the team never sent them tokens (FUNDED_WALLETS).
 * Everything left out is counted by reason. A receipt is linked only when that doesn't tell whose
 * wallet it is: private team wallets and the people we funded are counted, never listed.
 */
export const EDITION2_CODE = "celo_0acfe36b6ea3";
export const EDITION2_SINCE = "2026-11-20T00:00:00.000Z";

/** The track's corridors: USD₮ ↔ each of these, either way. */
export const TRACK_LOCALS: readonly string[] = ["cNGN", "IDRX", "wARS", "wBRL", "wMXN", "wCOP"];

export const EXCLUSIONS = ["untagged", "team_taker", "funded_taker", "own_desk_fill", "not_textile", "off_corridor"] as const;
export type Exclusion = (typeof EXCLUSIONS)[number];

/** One Textile firm leg in a listed corridor. */
export interface E2Leg {
  /** "USDT>cNGN": token symbols, in the direction traded. */
  corridor: string;
  from: TokenRef;
  to: TokenRef;
  /** The local side. */
  local: { token: TokenRef; amount: bigint };
  /** The USD₮ side, in micro-dollars. */
  usdMicros: bigint;
}

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
  legs: E2Leg[];
}

export interface Edition2 {
  conversions: E2Conversion[];
  byCorridor: { corridor: string; from: TokenRef; to: TokenRef; count: number; usdMicros: bigint; local: { token: TokenRef; amount: bigint }; ids: string[] }[];
  payers: { address: string; ids: string[] }[];
  /** Payees outside the team, never funded by it, who received local currency (a send's recipient). */
  recipients: { address: string; ids: string[] }[];
  repeatPayers: number;
  totalUsdMicros: bigint;
  /** Every exclusion, by reason. */
  excludedCounts: Partial<Record<Exclusion, number>>;
  /** The ones that can be linked without naming a private wallet. */
  excluded: { id: string; reason: Exclusion; executionTx: string }[];
}

type Firm = { kind?: string; quote?: { orders?: { maker?: string }[] } };

const isLocal = (t: TokenRef) => t.fiat !== "USD" && t.fiat !== "?";

function trackLeg(q: { tokenIn: string; tokenOut: string; amountIn: string; amountOut: string }): E2Leg | null {
  const from = tokenRef(q.tokenIn);
  const to = tokenRef(q.tokenOut);
  const buysLocal = from.symbol === "USDT" && TRACK_LOCALS.includes(to.symbol);
  if (!buysLocal && !(to.symbol === "USDT" && TRACK_LOCALS.includes(from.symbol))) return null;
  const amountIn = BigInt(q.amountIn);
  const amountOut = BigInt(q.amountOut);
  return {
    corridor: `${from.symbol}>${to.symbol}`,
    from,
    to,
    local: buysLocal ? { token: to, amount: amountOut } : { token: from, amount: amountIn },
    usdMicros: buysLocal ? amountIn : amountOut,
  };
}

export function computeEdition2(records: ReceiptRecord[], o: { team: ReadonlySet<string>; funded?: ReadonlySet<string>; since?: string }): Edition2 {
  const { team, funded = new Set<string>(), since = EDITION2_SINCE } = o;
  const independent = (a: string) => !team.has(a) && !funded.has(a);
  const out: Edition2 = { conversions: [], byCorridor: [], payers: [], recipients: [], repeatPayers: 0, totalUsdMicros: 0n, excludedCounts: {}, excluded: [] };
  const corridors = new Map<string, Edition2["byCorridor"][number]>();
  const payers = new Map<string, { address: string; ids: string[] }>();
  const recipients = new Map<string, { address: string; ids: string[] }>();

  for (const r of records) {
    const b = r.bundle;
    if (r.supersededBy || b.createdAt < since) continue;
    const exclude = (reason: Exclusion, listed = true) => {
      out.excludedCounts[reason] = (out.excludedCounts[reason] ?? 0) + 1;
      if (listed) out.excluded.push({ id: r.id, reason, executionTx: b.execution.txHash });
    };
    if (!b.execution.attribution.includes(EDITION2_CODE)) {
      exclude("untagged");
      continue;
    }
    const taker = b.request.taker.toLowerCase();
    if (team.has(taker)) {
      exclude("team_taker", isPublicTeamWallet(taker));
      continue;
    }
    if (funded.has(taker)) {
      exclude("funded_taker", false);
      continue;
    }
    const firms = b.chosen.legs.map((l) => l.quote).filter((q) => q.venue === "textile_rfq" && (q.raw as Firm | null)?.kind === "firm");
    if (!firms.length) {
      exclude("not_textile");
      continue;
    }
    const legs = firms.map(trackLeg).filter((l): l is E2Leg => l !== null);
    if (!legs.length) {
      exclude("off_corridor");
      continue;
    }
    if (firms.some((q) => ((q.raw as Firm).quote?.orders ?? []).some((x) => !!x.maker && isOwnMaker(x.maker)))) {
      exclude("own_desk_fill");
      continue;
    }

    const tokenOut = tokenRef(b.request.tokenOut);
    const amountOut = BigInt(b.execution.amountOut);
    const usd = r.usdMicros != null ? BigInt(r.usdMicros) : usdNotionalMicros(b);
    const recipient = b.request.recipient ? b.request.recipient.toLowerCase() : null;
    out.conversions.push({
      id: r.id,
      createdAt: b.createdAt,
      taker,
      recipient,
      tokenIn: tokenRef(b.request.tokenIn),
      tokenOut,
      amountIn: BigInt(b.request.amountIn),
      amountOut,
      usdMicros: usd,
      executionTx: b.execution.txHash,
      deliveryTx: b.execution.deliveryTxHash ?? null,
      legs,
    });
    out.totalUsdMicros += usd ?? 0n;

    for (const l of legs) {
      const k = corridors.get(l.corridor) ?? { corridor: l.corridor, from: l.from, to: l.to, count: 0, usdMicros: 0n, local: { token: l.local.token, amount: 0n }, ids: [] };
      k.count += 1;
      k.usdMicros += l.usdMicros;
      k.local.amount += l.local.amount;
      k.ids.push(r.id);
      corridors.set(l.corridor, k);
    }

    const p = payers.get(taker) ?? { address: taker, ids: [] };
    p.ids.push(r.id);
    payers.set(taker, p);
    if (recipient && recipient !== taker && independent(recipient) && isLocal(tokenOut) && amountOut > 0n) {
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
