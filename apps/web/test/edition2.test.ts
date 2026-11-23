import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEAM_WALLETS, TOKENS, addressSet, teamWallets } from "@arbolito/config";
import { readFileRecord, type ReceiptRecord } from "../src/lib/data";
import { EDITION2_CODE, computeEdition2 } from "../src/lib/edition2";

const dir = fileURLToPath(new URL("../../../docs/receipts/", import.meta.url));
const base = readFileRecord("bf28b8ab-31a9-4679-8028-bcb471f7d980", dir)!;

const PAYER = "0x00000000000000000000000000000000000000a1";
const PAYER2 = "0x00000000000000000000000000000000000000a2";
const ADA = "0x00000000000000000000000000000000000000b1";
const OTHER_MAKER = "0x00000000000000000000000000000000000000c1";

let n = 0;
/** A USDT→cNGN (or →wARS) receipt shaped like the Mini App's: one Textile firm leg. */
function rec(o: { taker?: string; recipient?: string; codes?: string[]; maker?: string; at?: string; to?: "cNGN" | "wARS" | "USDC"; sell?: "cNGN"; venue?: "textile_rfq" | "uniswap_v3"; out?: bigint }): ReceiptRecord {
  const from = o.sell ? TOKENS[o.sell] : TOKENS.USDT;
  const to = o.sell ? TOKENS.USDT : TOKENS[o.to ?? "cNGN"];
  const out = o.out ?? 75_000_000_000n;
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const quote = {
    venue: o.venue ?? "textile_rfq",
    tokenIn: from.address,
    tokenOut: to.address,
    amountIn: "52000000",
    amountOut: out.toString(),
    blockNumber: "1",
    firm: true,
    raw: { kind: "firm", quote: { orders: [{ maker: o.maker ?? OTHER_MAKER }] } },
  };
  const bundle = structuredClone(base.bundle);
  bundle.createdAt = o.at ?? "2026-11-24T10:00:00.000Z";
  bundle.request = { tokenIn: from.address, tokenOut: to.address, amountIn: "52000000", taker: o.taker ?? PAYER, recipient: o.recipient };
  bundle.chosen = { ...bundle.chosen, tokenIn: from.address, tokenOut: to.address, legs: [{ quote, minOut: out.toString() }] } as typeof bundle.chosen;
  bundle.execution = { ...bundle.execution, txHash: `0x${String(n).padStart(64, "0")}`, amountOut: out.toString(), attribution: o.codes ?? [EDITION2_CODE, "celo_e054d92430a5"] };
  return { ...base, id, bundle, usdMicros: "52000000", supersededBy: null, supersedes: null };
}

describe("edition 2 metrics", () => {
  const team = teamWallets();

  it("counts tagged Textile taker conversions by independent wallets, with payees and corridors", () => {
    const m = computeEdition2(
      [
        rec({ recipient: ADA }),
        rec({ recipient: ADA }),
        rec({ taker: PAYER2, to: "wARS", out: 91_000n * 10n ** 18n }),
      ],
      { team },
    );
    expect(m.conversions).toHaveLength(3);
    expect(m.payers.map((p) => p.address).sort()).toEqual([PAYER, PAYER2]);
    expect(m.repeatPayers).toBe(1);
    expect(m.recipients.map((r) => [r.address, r.ids.length])).toEqual([[ADA, 2]]);
    const ngn = m.byCorridor.find((c) => c.corridor === "USDT>cNGN")!;
    expect([ngn.count, ngn.local.amount, ngn.usdMicros]).toEqual([2, 150_000_000_000n, 104_000_000n]);
    expect(m.byCorridor.find((c) => c.corridor === "USDT>wARS")!.count).toBe(1);
    expect(m.totalUsdMicros).toBe(156_000_000n);
    expect(m.excluded).toEqual([]);
  });

  it("leaves out, with the reason: untagged, team takers, our desk as maker, non-Textile, before 20 Nov", () => {
    const m = computeEdition2(
      [
        rec({ codes: ["celo_e054d92430a5"] }),
        rec({ taker: TEAM_WALLETS.founderMiniPay }),
        rec({ maker: TEAM_WALLETS.desk }),
        rec({ venue: "uniswap_v3" }),
        rec({ at: "2026-11-19T23:59:59.000Z" }),
      ],
      { team },
    );
    expect(m.conversions).toEqual([]);
    expect(m.excluded.map((e) => e.reason)).toEqual(["untagged", "team_taker", "own_desk_fill", "not_textile"]);
  });

  it("never counts a team wallet as a payee", () => {
    const m = computeEdition2([rec({ recipient: TEAM_WALLETS.ops }), rec({ recipient: TEAM_WALLETS.founderMiniPay2 })], { team });
    expect([m.conversions.length, m.recipients.length]).toEqual([2, 0]);
  });

  it("counts listed corridors only, labelled in the direction traded", () => {
    const m = computeEdition2([rec({ sell: "cNGN", out: 50_000_000n }), rec({ to: "USDC", out: 51_000_000n })], { team });
    expect(m.byCorridor.map((c) => [c.corridor, c.count, c.usdMicros, c.local.amount])).toEqual([["cNGN>USDT", 1, 50_000_000n, 52_000_000n]]);
    expect(m.conversions).toHaveLength(1);
    expect(m.excluded.map((e) => e.reason)).toEqual(["off_corridor"]);
  });

  it("leaves out wallets we funded, as payers and as payees", () => {
    const funded = addressSet(`${PAYER2},${ADA}`);
    const m = computeEdition2([rec({ taker: PAYER2 }), rec({ recipient: ADA })], { team, funded });
    expect([m.conversions.length, m.payers.map((p) => p.address), m.recipients.length]).toEqual([1, [PAYER], 0]);
    expect(m.excludedCounts).toEqual({ funded_taker: 1 });
  });

  it("counts private wallets' exclusions without listing them", () => {
    const m = computeEdition2([rec({ taker: PAYER }), rec({ taker: PAYER2 }), rec({ taker: TEAM_WALLETS.ops })], { team: teamWallets(PAYER), funded: addressSet(PAYER2) });
    expect(m.excludedCounts).toEqual({ team_taker: 2, funded_taker: 1 });
    expect(m.excluded).toHaveLength(1); // the ops wallet, already public
  });
});
