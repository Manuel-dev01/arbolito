import type { ProofBundle } from "@arbolito/proof";
import type { ReceiptRecord } from "../../lib/data";
import { resolveRate, type ReferenceName } from "../../lib/receipt-view";

/**
 * Pure helpers behind the public pages (no Next or React imports), so they are unit-testable:
 * calculator rows, the landing's showcase receipt and the receipt badge.
 */

export { parseTyped } from "./parse-amount";

type Ref = ProofBundle["references"][number];

export type CalcKey = "arbolito" | "official" | "mep" | "blue" | "ccl" | "crypto";

export interface CalcRow {
  key: CalcKey;
  /** ARS per 1 unit of the input currency, 1e18-scaled, as a decimal string (bigint-safe for the client). */
  rate: string;
  source: string;
}

export type CalcRows = Record<"USD" | "BRL", CalcRow[]>;

/** "Arbolito" is the market mid on Celo: Uniswap (what executes) first, Textile's ticker as fallback. */
const MARKET: ReferenceName[] = ["uniswap_mid", "textile_mid"];

function row(refs: Ref[], key: CalcKey, names: ReferenceName[], base: string): CalcRow | undefined {
  for (const name of names) {
    const hit = resolveRate(refs, name, base, "ARS");
    if (hit && hit.rate > 0n) return { key, rate: hit.rate.toString(), source: hit.ref.source };
  }
  return undefined;
}

/** Rows for "Hacé la cuenta": US$ → ARS against official/MEP/blue/CCL/crypto, R$ → ARS against official. */
export function calcRows(refs: Ref[]): CalcRows {
  const usd = [
    row(refs, "arbolito", MARKET, "USD"),
    row(refs, "official", ["official"], "USD"),
    row(refs, "mep", ["mep"], "USD"),
    row(refs, "blue", ["blue"], "USD"),
    row(refs, "ccl", ["ccl"], "USD"),
    row(refs, "crypto", ["crypto"], "USD"),
  ];
  const brl = [row(refs, "arbolito", MARKET, "BRL"), row(refs, "official", ["official"], "BRL")];
  const keep = (xs: (CalcRow | undefined)[]) => {
    const rows = xs.filter((x): x is CalcRow => !!x);
    // Without both our rate and the official one there is no comparison to show.
    return rows.some((r) => r.key === "arbolito") && rows.some((r) => r.key === "official") ? rows : [];
  };
  return { USD: keep(usd), BRL: keep(brl) };
}

/** The receipt the landing shows: the newest active one with a positive saving, else the newest active one. */
export function pickShowcase(records: ReceiptRecord[]): ReceiptRecord | undefined {
  const active = records.filter((r) => !r.supersededBy);
  return active.find((r) => r.bundle.savings && BigInt(r.bundle.savings.delta) > 0n) ?? active[0];
}

export type BadgeState = "verified" | "pending" | "mismatch" | "unavailable" | "superseded";

/** A receipt younger than this whose hash is not anchored yet is "Registrando", not "No coincide". */
export const PENDING_WINDOW_MS = 15 * 60_000;

/**
 * The receipt's verification badge from the server-side check:
 * verified → Verificado; not anchored yet and fresh → Registrando; anything else that failed → No coincide.
 * When the chain could not be reached: Registrando while fresh, otherwise "unavailable".
 */
export function badgeState(
  superseded: boolean,
  createdAt: string,
  server: { result?: { ok: boolean; anchor: unknown }; error?: string },
  now: number = Date.now(),
): BadgeState {
  if (superseded) return "superseded";
  const r = server.result;
  if (r?.ok) return "verified";
  const fresh = now - Date.parse(createdAt) < PENDING_WINDOW_MS;
  if (r) return !r.anchor && fresh ? "pending" : "mismatch";
  return fresh ? "pending" : "unavailable";
}
