/**
 * Mock mode (?mock=1): a fake /api/miniapp/* that satisfies the contract types, and a fake wallet
 * whose "MiniPay sheet" is rendered by the app (Confirmar / Rechazar). Nothing here touches a chain.
 * Numbers follow the design: R$ 10 → ARS 3.177,41 (+5,24% vs oficial), US$ 1 = ARS 1.608.
 */
import type { Address, Hex } from "viem";
import type { Sym } from "../contract";
import { CUR_OF, DECIMALS, parseHuman, type Cur, type Lang } from "./format";
import type { Contact, KV, ReceiptIndexEntry } from "./store";
import type { Wallet } from "./wallet";

export type MockFail = "reject" | "revert" | "no_route" | "price_changed" | "proof" | "expired" | "not_ready" | "upstream" | "mismatch";

export interface MockScenario {
  emptyBalances?: boolean;
  offline?: boolean;
  slowBalances?: boolean;
  noReceipts?: boolean;
  noContacts?: boolean;
  paused?: boolean;
  autoOn?: boolean;
  /** /quotes/open returns a fresh quote once (a Telegram quote waiting to be confirmed). */
  openQuote?: boolean;
  fail?: MockFail | null;
  /** The app's language, for the demo sheet's call labels. */
  lang?: Lang;
}

/** Call labels on the demo's MiniPay sheet. */
const CALL_LABEL: Record<Lang, { approve: string; change: string; send: string; changeSend: string; permit: string; activate: string; revoke: string }> = {
  es: { approve: "Aprobar", change: "Cambiar", send: "Enviar", changeSend: "Cambiar y enviar", permit: "Permiso con límite", activate: "Activar Arbolito", revoke: "Revocar permiso" },
  pt: { approve: "Aprovar", change: "Trocar", send: "Enviar", changeSend: "Trocar e enviar", permit: "Permissão com limite", activate: "Ativar o Arbolito", revoke: "Revogar permissão" },
  en: { approve: "Approve", change: "Change", send: "Send", changeSend: "Change and send", permit: "Limited permission", activate: "Turn on Arbolito", revoke: "Revoke permission" },
};

/** Clearly fake demo account (never a real wallet). */
export const MOCK_ACCOUNT: Address = "0x5a1c1a000000000000000000000000000000a4b0";

/** ARS per one unit of each currency. */
const R: Record<Cur, number> = { ARS: 1, BRL: 317.74119, USD: 1608 };
/** % better than the official rate, by the non-peso side. */
const OFF: Partial<Record<Cur, number>> = { BRL: 5.24, USD: 4.08 };

const ONE = 10n ** 18n;
const rateOf = (from: Cur, to: Cur): bigint => parseHuman((R[from] / R[to]).toFixed(12), 18);

function convert(amountIn: bigint, from: Sym, to: Sym): bigint {
  const r = rateOf(CUR_OF[from], CUR_OF[to]);
  return (amountIn * r * 10n ** BigInt(DECIMALS[to])) / (ONE * 10n ** BigInt(DECIMALS[from]));
}

function pctFor(from: Cur, to: Cur): number | null {
  if (to === "ARS" && OFF[from]) return OFF[from]!;
  if (from === "ARS" && OFF[to]) return OFF[to]!;
  return null;
}

const uuid = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    const h = () => Math.floor(Math.random() * 16).toString(16);
    return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, h);
  }
};
const randHex = (bytes: number): Hex => {
  let s = "0x";
  for (let i = 0; i < bytes; i++) s += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return s as Hex;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The persona's balances (es: Lucía) in whole units. */
const PERSONA_BAL: Record<Cur, number> = { ARS: 182450, BRL: 1240, USD: 860 };

export function mockQuote(from: Sym, to: Sym, amount: string, id = uuid(), validMs = 48_000) {
  const amountIn = parseHuman(amount, DECIMALS[from]);
  const expectedOut = convert(amountIn, from, to);
  const pct = pctFor(CUR_OF[from], CUR_OF[to]);
  const bps = pct === null ? 0n : BigInt(Math.round(pct * 100));
  const deltaOut = pct === null ? 0n : expectedOut - (expectedOut * 10000n) / (10000n + bps);
  const two = (CUR_OF[from] === "BRL" && CUR_OF[to] === "ARS") || (CUR_OF[from] === "ARS" && CUR_OF[to] === "BRL");
  const rate = (R[CUR_OF[from]] / R[CUR_OF[to]]).toFixed(6);
  const now = new Date();
  const offRate = pct === null ? null : (Number(rate) / (1 + pct / 100)).toFixed(2);
  return {
    quoteId: id,
    expiresAt: new Date(now.getTime() + validMs).toISOString(),
    from,
    to,
    amountIn: amountIn.toString(),
    expectedOut: expectedOut.toString(),
    minOut: ((expectedOut * 995n) / 1000n).toString(),
    rate,
    vsOfficial: pct === null ? null : { pct, pair: `${CUR_OF[from]}/${CUR_OF[to]}`, deltaOut: deltaOut.toString() },
    steps: two ? 2 : 1,
    venues: (two ? ["textile", "uniswap"] : ["uniswap"]) as ("uniswap" | "textile")[],
    usesTextile: two,
    alternatives: [
      { expectedOut: ((expectedOut * 9946n) / 10000n).toString(), venues: ["uniswap"] as ("uniswap" | "textile")[], diffBps: -54 },
    ],
    references: offRate ? [{ name: "Oficial", pair: `${CUR_OF[from]}/${CUR_OF[to]}`, rate: offRate, source: "BCRA", at: now.toISOString() }] : [],
  };
}

type MockQuote = ReturnType<typeof mockQuote>;

interface MockReceipt {
  receiptId: string;
  createdAtMs: number;
  from: Sym;
  to: Sym;
  amountIn: string;
  amountOut: string;
  savings: { pct: number; deltaOut: string; pair: string } | null;
  executionTx: Hex;
  forceStatus?: "verified" | "mismatch";
}

const DAY = 86_400_000;
function at(daysAgo: number, hh: number, mm: number): Date {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hh, mm, 0, 0);
  return d;
}

/** The design's four receipts. */
function seedReceipts(): { index: ReceiptIndexEntry[]; receipts: MockReceipt[] } {
  const rows: { from: Sym; to: Sym; amt: string; when: Date; kind: "change" | "send"; to2?: string }[] = [
    { from: "wBRL", to: "wARS", amt: "10", when: at(0, 10, 42), kind: "change" },
    { from: "USDT", to: "wARS", amt: "20", when: at(1, 20, 3), kind: "send", to2: "Graciela" },
    { from: "USDT", to: "wARS", amt: "100", when: at(3, 9, 12), kind: "change" },
    { from: "wBRL", to: "wARS", amt: "1200", when: at(10, 8, 30), kind: "change" },
  ];
  const ids = ["a7f329c1-5b2e-4d0a-9e1f-3c6b8d2a41c7", "c9e104aa-2f6d-4b8e-a1c3-7d5e9f0b2c64", "b21c07d3-8e4f-4a6b-9c2d-1e3f5a7b9c0d", "d4e8a2f1-6c3b-4d9e-8a7f-2b1c0d9e8f7a"];
  const receipts = rows.map((r, i) => {
    const q = mockQuote(r.from, r.to, r.amt);
    return {
      receiptId: ids[i]!,
      createdAtMs: r.when.getTime(),
      from: r.from,
      to: r.to,
      amountIn: q.amountIn,
      amountOut: q.expectedOut,
      savings: q.vsOfficial,
      executionTx: "0x7b2e9c41d0a5f6e3b8c7d2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3e4d9" as Hex,
      forceStatus: "verified" as const,
    };
  });
  const index = rows.map((r, i) => ({ receiptId: ids[i]!, kind: r.kind, to: r.to2, at: r.when.toISOString() }));
  return { index, receipts };
}

export const MOCK_CONTACTS: Record<Lang, Omit<Contact, "id">[]> = {
  es: [
    { name: "Graciela Gómez", tag: "Mamá", cur: "ARS", phone: "+54 9 351 412-7781", address: "0x9a0c000000000000000000000000000000000001" },
    { name: "Martín Ferreyra", tag: "Alquiler", cur: "ARS", phone: "+54 9 11 4420-1934", address: "0x9a0c000000000000000000000000000000000002" },
    { name: "Agência Sol", tag: "Cliente", cur: "BRL", phone: "+55 11 98765-4321", address: "0x9a0c000000000000000000000000000000000003" },
    { name: "Tomás Ribeiro", tag: "", cur: "BRL", phone: "+55 21 99812-3307", address: "0x9a0c000000000000000000000000000000000004" },
  ],
  pt: [
    { name: "Lucía Gómez", tag: "Designer", cur: "ARS", phone: "+54 9 11 5832-4107", address: "0x9a0c000000000000000000000000000000000005" },
    { name: "Mateo Díaz", tag: "Dev", cur: "ARS", phone: "+54 9 11 6021-5590", address: "0x9a0c000000000000000000000000000000000006" },
    { name: "Camila Rocha", tag: "", cur: "BRL", phone: "+55 11 97321-8840", address: "0x9a0c000000000000000000000000000000000007" },
  ],
  en: [
    { name: "Graciela Gómez", tag: "Mom", cur: "ARS", phone: "+54 9 351 412-7781", address: "0x9a0c000000000000000000000000000000000001" },
    { name: "Martín Ferreyra", tag: "Rent", cur: "ARS", phone: "+54 9 11 4420-1934", address: "0x9a0c000000000000000000000000000000000002" },
    { name: "Agência Sol", tag: "Client", cur: "BRL", phone: "+55 11 98765-4321", address: "0x9a0c000000000000000000000000000000000003" },
    { name: "Tomás Ribeiro", tag: "", cur: "BRL", phone: "+55 21 99812-3307", address: "0x9a0c000000000000000000000000000000000004" },
  ],
};

export const MOCK_PERSONA: Record<Lang, { name: string; phone: string }> = {
  es: { name: "Lucía", phone: "+54 9 11 5832-4107" },
  pt: { name: "Agência Sol", phone: "+55 11 98765-4321" },
  en: { name: "Lucía", phone: "+54 9 11 5832-4107" },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const err = (status: number, code: string, message = code) => json(status, { error: { code, message } });

/** A fetch that serves /api/miniapp/* from memory. */
export function createMockServer(scenario: MockScenario) {
  const quotes = new Map<string, MockQuote>();
  const seeded = seedReceipts();
  const receipts = new Map<string, MockReceipt>(scenario.noReceipts ? [] : seeded.receipts.map((r) => [r.receiptId, r]));
  const polls = new Map<string, number>();
  const once = new Set<string>();
  const firstTime = (k: string) => (once.has(k) ? false : (once.add(k), true));
  /** Quote ids reported through /reject (tests read this). */
  const rejected: string[] = [];
  let autoOn = !!scenario.autoOn;
  let paused = !!scenario.paused;
  const L = CALL_LABEL[scenario.lang ?? "es"];

  const usd = (cur: Cur, units: number) => BigInt(Math.round(((units * R[cur]) / R.USD) * 1e6));

  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const u = new URL(url, "http://mock.local");
    const path = u.pathname.replace(/^\/api\/miniapp/, "");
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const fail = scenario.fail ?? null;
    await sleep(250);

    if (path === "/rates") {
      const now = new Date().toISOString();
      return json(200, {
        at: now,
        references: [
          { name: "Oficial", pair: "USD/ARS", rate: "1545.00", source: "BCRA", at: now },
          { name: "Oficial", pair: "BRL/ARS", rate: "302.89", source: "BCRA", at: now },
        ],
      });
    }
    if (path === "/balances") {
      if (scenario.offline) throw new TypeError("Failed to fetch");
      if (scenario.slowBalances) await sleep(1500);
      const units = scenario.emptyBalances ? { ARS: 0, BRL: 0, USD: 0 } : PERSONA_BAL;
      return json(200, {
        account: u.searchParams.get("account"),
        balances: [
          { sym: "wARS", amount: parseHuman(String(units.ARS), 18).toString(), decimals: 18 },
          { sym: "wBRL", amount: parseHuman(String(units.BRL), 18).toString(), decimals: 18 },
          { sym: "USDT", amount: parseHuman(String(units.USD), 6).toString(), decimals: 6 },
        ],
        usdMicros: { wARS: usd("ARS", units.ARS).toString(), wBRL: usd("BRL", units.BRL).toString(), USDT: usd("USD", units.USD).toString(), USAT: "0", USDC: "0" },
        blockNumber: "79491985",
      });
    }
    if (path === "/quote" && init?.method === "POST") {
      await sleep(800);
      if (fail === "no_route") return err(422, "no_route", "no market");
      if (fail === "upstream") return err(502, "upstream", "upstream");
      const q = mockQuote(body.from as Sym, body.to as Sym, String(body.amount));
      quotes.set(q.quoteId, q);
      return json(200, q);
    }
    if (path === "/reject") {
      rejected.push(String(body.quoteId));
      return json(200, { quoteId: body.quoteId, status: "failed" });
    }
    if (path === "/quotes/open") {
      if (!scenario.openQuote || !firstTime("open")) return json(200, { quote: null });
      const q = mockQuote("USDT", "wARS", "100");
      quotes.set(q.quoteId, q);
      return json(200, { quote: q });
    }
    const byId = /^\/quote\/([0-9a-f-]{36})$/.exec(path);
    if (byId) {
      const q = quotes.get(byId[1]!) ?? mockQuote("USDT", "wARS", "100", byId[1]!);
      quotes.set(q.quoteId, q);
      return json(200, q);
    }
    if (path === "/prepare") {
      await sleep(400);
      const q = quotes.get(String(body.quoteId));
      if (!q) return err(404, "quote_expired", "unknown quote");
      if (fail === "expired" || Date.parse(q.expiresAt) < Date.now()) return err(410, "quote_expired", "expired");
      if (fail === "price_changed" && firstTime("price")) return err(409, "price_changed", "price moved");
      if (fail === "proof" && !body.takerProof) {
        return json(409, {
          error: { code: "needs_taker_proof", message: "sign once" },
          typedData: { domain: { name: "Textile", version: "2", chainId: 42220 }, primaryType: "TakerControl", types: {}, message: {} },
          eip191Message: "Textile taker proof (mock)",
          nonce: randHex(16),
          issuedAt: Math.floor(Date.now() / 1000),
        });
      }
      return json(200, {
        quoteId: q.quoteId,
        calls: [
          { to: "0x0000000000000000000000000000000000000001", data: "0x095ea7b3", value: "0", label: `${L.approve} ${q.from}` },
          { to: "0x0000000000000000000000000000000000000002", data: "0x3593564c", value: "0", label: `${L.change} ${q.from} → ${q.to}` },
        ],
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        expectedOut: q.expectedOut,
        minOut: q.minOut,
      });
    }
    if (path === "/submit") {
      const q = quotes.get(String(body.quoteId));
      const id = uuid();
      receipts.set(id, {
        receiptId: id,
        createdAtMs: Date.now(),
        from: q?.from ?? "wBRL",
        to: q?.to ?? "wARS",
        amountIn: q?.amountIn ?? "0",
        amountOut: q?.expectedOut ?? "0",
        savings: q?.vsOfficial ?? null,
        executionTx: ((body.txHashes as string[]) ?? []).at(-1) as Hex,
        forceStatus: fail === "mismatch" ? "mismatch" : undefined,
      });
      return json(200, { receiptId: id, status: "registering", url: `/r/${id}` });
    }
    const rc = /^\/receipt\/([0-9a-f-]{36})$/.exec(path);
    if (rc) {
      const r = receipts.get(rc[1]!);
      if (!r) return err(404, "bad_request", "unknown receipt");
      const n = (polls.get(r.receiptId) ?? 0) + 1;
      polls.set(r.receiptId, n);
      const fresh = Date.now() - r.createdAtMs < 60_000;
      const status = fresh && n < 3 ? "registering" : r.forceStatus === "mismatch" ? "mismatch" : "verified";
      return json(200, {
        receiptId: r.receiptId,
        status,
        url: `/r/${r.receiptId}`,
        from: r.from,
        to: r.to,
        amountIn: r.amountIn,
        amountOut: r.amountOut,
        savings: r.savings,
        executionTx: r.executionTx,
        anchorTx: status === "registering" ? null : "0x83bbf7a6fd68ca0b0bfd632b931b80fbc078b3dc00ff0125ac0eee3772f91263",
        createdAt: new Date(r.createdAtMs).toISOString(),
      });
    }
    if (path === "/autonomy/status") {
      return json(200, {
        account: u.searchParams.get("account"),
        configured: autoOn,
        paused,
        operatorActive: autoOn && !paused,
        operatorExpiry: autoOn ? new Date(Date.now() + 30 * DAY).toISOString() : null,
        maxSlippageBps: 50,
        limits: autoOn
          ? [{ sym: "USDT", perTx: "25000000", perDay: "100000000", spentToday: "41000000" }]
          : [],
        contacts: autoOn ? ["0x9a0c000000000000000000000000000000000001", "0x9a0c000000000000000000000000000000000002"] : [],
      });
    }
    if (path === "/autonomy/plan") {
      await sleep(400);
      if (fail === "not_ready") return err(503, "not_ready", "guard not deployed");
      autoOn = true;
      paused = false;
      return json(200, {
        calls: [
          { to: "0x0000000000000000000000000000000000000003", data: "0x095ea7b3", value: "0", label: L.permit },
          { to: "0x0000000000000000000000000000000000000004", data: "0x8a8c523c", value: "0", label: L.activate },
        ],
      });
    }
    if (path === "/autonomy/revoke-plan") {
      autoOn = false;
      paused = false;
      return json(200, { calls: [{ to: "0x0000000000000000000000000000000000000004", data: "0x2e1a7d4d", value: "0", label: L.revoke }] });
    }
    if (path === "/autonomy/pause") {
      paused = !!body.paused;
      return json(200, { paused });
    }
    if (path === "/chat") {
      await sleep(900);
      const lang = (body.lang as Lang) ?? "es";
      const text = typeof body.text === "string" ? body.text : null;
      const transcript = text ? null : lang === "pt" ? "troca 200 reais por pesos" : lang === "en" ? "change 100 dollars to pesos" : "pasá 100 dólares a pesos";
      const said = (text ?? transcript ?? "").toLowerCase();
      const amt = /(\d+(?:[.,]\d+)?)/.exec(said)?.[1]?.replace(",", ".") ?? (lang === "pt" ? "200" : "100");
      const from: Sym = /real|reai|brl|r\$/.test(said) ? "wBRL" : /peso|ars/.test(said) && !/a pesos|to pesos|por pesos/.test(said) ? "wARS" : "USDT";
      const to: Sym = from === "wARS" ? "USDT" : "wARS";
      if (fail === "no_route") return json(200, { transcript, reply: lang === "en" ? "No market right now for that pair." : "Ahora no hay mercado para ese cambio.", quotes: [] });
      const q = mockQuote(from, to, amt);
      quotes.set(q.quoteId, q);
      const reply = lang === "pt" ? "Achei o melhor preço. Confirme no MiniPay quando quiser." : lang === "en" ? "Here's the best rate right now. Confirm in MiniPay when you're ready." : "Encontré el mejor precio. Confirmalo en MiniPay cuando quieras.";
      return json(200, { transcript, reply, quotes: [q] });
    }
    if (path === "/link/confirm") {
      await sleep(500);
      if (body.code === "0000") return err(400, "bad_request", "unknown code");
      return json(200, { linked: true, telegramName: "@lucia.dg" });
    }
    if (path.startsWith("/receipts")) return json(200, { receipts: [] }); // mock receipts live in the local index
    if (path.startsWith("/link/status")) return json(200, { linked: true, telegramName: "@lucia.dg" });
    if (path === "/rules/confirm" || path === "/rules/cancel") return err(400, "bad_request", "Automatic rules aren't available in the demo.");
    if (path.startsWith("/rules")) return json(200, { rules: [], runs: [] });
    if (path === "/send/prepare") {
      await sleep(400);
      const amountIn = parseHuman(String(body.amount), DECIMALS[body.from as Sym]);
      const out = convert(amountIn, body.from as Sym, body.to as Sym);
      const calls = body.from === body.to
        ? [{ to: "0x0000000000000000000000000000000000000005", data: "0xa9059cbb", value: "0", label: L.send }]
        : [
            { to: "0x0000000000000000000000000000000000000001", data: "0x095ea7b3", value: "0", label: `${L.approve} ${String(body.from)}` },
            { to: "0x0000000000000000000000000000000000000002", data: "0x3593564c", value: "0", label: L.changeSend },
          ];
      return json(200, { calls, expectedOut: out.toString(), minOut: ((out * 995n) / 1000n).toString() });
    }
    return err(404, "bad_request", `mock: no route for ${path}`);
  }

  return {
    fetch: (input: string, init?: RequestInit) => handle(input, init),
    receiptIndex: (): ReceiptIndexEntry[] => (scenario.noReceipts ? [] : seeded.index),
    rejected,
  };
}

export interface SheetRequest {
  kind: "tx" | "sign";
  /** The call's label from /prepare ("Aprobar wBRL"), or what is being signed. */
  label: string;
}

/** A fake wallet: every send or signature waits on the app's fake MiniPay sheet. */
export function createMockWallet(opts: { confirm(req: SheetRequest): Promise<boolean>; fail?: MockFail | null; lang: Lang }): Wallet {
  const reject = () => Object.assign(new Error("User rejected the request."), { code: 4001, name: "UserRejectedRequestError" });
  const labels = new Map<Hex, string>();
  const isApproval = (data: string) => data.startsWith("0x095ea7b3");
  const sign = async () => {
    if (!(await opts.confirm({ kind: "sign", label: "Textile" }))) throw reject();
    return randHex(65);
  };
  return {
    account: MOCK_ACCOUNT,
    real: false,
    sender: {
      async send(call) {
        if (!(await opts.confirm({ kind: "tx", label: call.label }))) throw reject();
        await sleep(500);
        const h = randHex(32);
        labels.set(h, call.data);
        return h;
      },
    },
    waiter: {
      async wait(hash) {
        await sleep(900);
        // ?fail=revert makes the swap/payment revert (approvals still succeed).
        return opts.fail === "revert" && !isApproval(labels.get(hash) ?? "") ? "reverted" : "success";
      },
    },
    signer: { signTypedData: sign, personalSign: sign },
    async requestContact() {
      await sleep(300);
      return { name: opts.lang === "pt" ? "Camila Rocha" : "Tomás Ribeiro", address: "0x9a0c000000000000000000000000000000000004" };
    },
  };
}

/** In-memory KV so mock mode never writes the real phone's storage. */
export function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
