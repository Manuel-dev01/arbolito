"use client";

import { useEffect } from "react";
import type { Sym } from "../../../lib/miniapp/contract";
import type { Quote } from "../../../lib/miniapp/client/api";
import { countdown } from "../../../lib/miniapp/client/countdown";
import { balanceOf, usdToCur } from "../../../lib/miniapp/client/derive";
import {
  atomicToTyped,
  CUR_OF,
  DECIMALS,
  decimalKey,
  fmtMoney,
  fmtPct,
  fmtSaved,
  gainOf,
  fmtRateLine,
  fmtSym,
  fmtTyped,
  parseHuman,
  PREFIX,
  SYM_OF,
  type Cur,
} from "../../../lib/miniapp/client/format";
import { isPositive, KEYS, pressKey, type Key } from "../../../lib/miniapp/client/keypad";
import { fill, type MiniDict } from "../../../i18n/miniapp";
import { Frame, useApp, useNow } from "../context";
import { Badge, CountdownBar, CountdownText, NoMoneyMoved, ReceiptBadge, Spinner } from "../ui";
import { useReceipt } from "../useReceipts";
import { receiptRef } from "../../../lib/miniapp/client/format";

const CYCLE: Cur[] = ["BRL", "USD", "ARS"];

export function Keypad({ value, onChange }: { value: string; onChange(v: string): void }) {
  const { lang, t } = useApp();
  return (
    <div className="mp-keypad">
      {KEYS.map((k: Key) => (
        <button key={k} type="button" onClick={() => onChange(pressKey(value, k))} aria-label={k === "del" ? t.back : undefined}>
          {k === "del" ? "⌫" : k === "." ? decimalKey(lang) : k}
        </button>
      ))}
    </div>
  );
}

export function CurPill({ cur, onClick }: { cur: Cur; onClick?: () => void }) {
  const { t } = useApp();
  const inner = (
    <>
      <Badge cur={cur} size={36} />
      {t.curName[cur]} {onClick ? <span style={{ color: "var(--muted)" }}>▾</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="mp-pill" onClick={onClick}>
      {inner}
    </button>
  ) : (
    <span className="mp-row" style={{ gap: 8, fontSize: 16, fontWeight: 700 }}>
      {inner}
    </span>
  );
}

/** Indicative "≈" amount from balance prices while typing (the firm number comes from /quote). */
function estimate(amount: string, from: Cur, to: Cur, prices: Partial<Record<Cur, bigint>>): bigint | null {
  const pf = prices[from];
  if (!pf || !isPositive(amount)) return null;
  const micros = (parseHuman(amount, 18) * pf) / 10n ** 18n;
  return usdToCur(micros, to, prices);
}

export function ChangeScreen() {
  const { t, lang, ch, setCh, bal, prices, requestQuote } = useApp();
  const from = CUR_OF[ch.from];
  const to = CUR_OF[ch.to];
  const have = balanceOf(bal.data, ch.from);
  const over = bal.data !== null && isPositive(ch.amount) && parseHuman(ch.amount, DECIMALS[ch.from]) > have;
  const est = estimate(ch.amount, from, to, prices);
  const rate = estimate("1", from, to, prices);
  const cycle = (which: "from" | "to") => {
    const cur = which === "from" ? from : to;
    const other = which === "from" ? to : from;
    const nx = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length]!;
    const p: { from?: Sym; to?: Sym } = { [which]: SYM_OF[nx] };
    if (nx === other) p[which === "from" ? "to" : "from"] = SYM_OF[cur];
    setCh({ ...p, quote: null });
  };
  const primary = !isPositive(ch.amount)
    ? { label: t.review, kind: "off" as const }
    : over
      ? { label: t.insufficient, kind: "off" as const }
      : { label: t.review, onClick: requestQuote };
  return (
    <Frame primary={primary}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, padding: "0 16px 8px" }}>
        <div className="mp-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6, overflow: "visible" }}>
          <div className="mp-between">
            <span className="mp-small">{t.chPay}</span>
            <CurPill cur={from} onClick={() => cycle("from")} />
          </div>
          <div className="mp-amount" style={{ fontSize: 43 }} aria-live="polite">
            {fmtTyped(ch.amount, from, lang)}
            <span className="mp-caret" aria-hidden="true" />
          </div>
          <button type="button" onClick={() => setCh({ amount: atomicToTyped(have, DECIMALS[ch.from]) })} style={{ alignSelf: "flex-start", textAlign: "left", minHeight: 32, border: 0, background: "transparent", padding: 0, color: "var(--muted)", fontSize: 14 }}>
            {t.available} {fmtSym(have, ch.from, lang)} · <b className="mp-save">{t.all}</b>
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "center", margin: "-22px 0", position: "relative", zIndex: 1 }}>
          <button type="button" className="mp-swap" aria-label="⇅" onClick={() => setCh({ from: ch.to, to: ch.from, quote: null })}>
            ⇅
          </button>
        </div>
        <div className="mp-sunk">
          <div className="mp-between">
            <span className="mp-small">{t.chGet}</span>
            <CurPill cur={to} onClick={() => cycle("to")} />
          </div>
          <div className="mp-amount mp-save" style={{ fontSize: 36, lineHeight: 1.15 }}>
            {est !== null ? `≈ ${fmtMoney(est, 18, to, lang)}` : `${PREFIX[to]} —`}
          </div>
          {rate !== null ? (
            <div className="mp-mono" style={{ fontSize: 13, color: "var(--muted)" }}>
              ≈ 1 {PREFIX[from]} = {fmtMoney(rate, 18, to, lang)}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[10, 50, 200].map((v) => (
            <button key={v} type="button" className="mp-chip" style={{ flex: 1, borderRadius: 12 }} onClick={() => setCh({ amount: String(v) })}>
              {PREFIX[from]} {v}
            </button>
          ))}
        </div>
        <Keypad value={ch.amount} onChange={(v) => setCh({ amount: v })} />
      </div>
    </Frame>
  );
}

export function QuoteLoading() {
  const { t } = useApp();
  return (
    <Frame primary={{ label: t.searching, kind: "busy" }}>
      <div className="mp-pad" style={{ paddingTop: 4 }}>
        <div className="mp-card pad" style={{ padding: 20, gap: 14 }} aria-busy="true">
          <div className="mp-row">
            <Spinner />
            <span className="mp-grow" style={{ fontSize: 17, fontWeight: 700 }}>
              {t.qLoadT}
            </span>
          </div>
          <div className="mp-small">{t.qLoadB}</div>
          <div className="mp-skel" style={{ height: 38, width: "75%" }} />
          <div className="mp-skel" style={{ height: 14, width: "45%" }} />
          <div style={{ height: 1, background: "var(--hairline)" }} />
          <div className="mp-skel" style={{ height: 14, width: "90%" }} />
          <div className="mp-skel" style={{ height: 14, width: "70%" }} />
        </div>
      </div>
    </Frame>
  );
}

export function routeText(q: Quote, t: MiniDict): string {
  const fiat = (s: Sym) => CUR_OF[s] !== "USD";
  if (q.steps === 2 && fiat(q.from) && fiat(q.to)) return fill(t.route2, { a: t.curLower[CUR_OF[q.from]], b: t.curLower[CUR_OF[q.to]] });
  if (q.steps === 1) return t.route1;
  return fill(t.routeN, { n: q.steps });
}

/** The quote card (variant a), shared by the Change flow; the chat uses a compact version. */
export function QuoteCardA({ q, quoteAt, now, dim }: { q: Quote; quoteAt: number; now: number; dim?: boolean }) {
  const { t, lang } = useApp();
  const exp = Date.parse(q.expiresAt);
  const cd = countdown(exp, now, exp - quoteAt);
  const gain = gainOf(q.vsOfficial);
  const saved = gain ? fmtSaved(gain.deltaOut, q.to, lang) : null;
  return (
    <div className={`mp-card ${dim || cd.phase === "expired" ? "mp-dim" : ""}`}>
      <CountdownBar cd={cd} />
      <div style={{ padding: "18px 18px 14px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="mp-between">
          <span className="mp-small">{t.chGet}</span>
          <CountdownText cd={cd} t={t} />
        </div>
        <div className="mp-amount" style={{ fontSize: 43 }}>
          {fmtSym(q.expectedOut, q.to, lang)}
        </div>
        <div style={{ fontSize: 16, color: "var(--muted)" }}>{fill(t.forX, { x: fmtSym(q.amountIn, q.from, lang) })}</div>
      </div>
      <div style={{ padding: "0 18px", display: "flex", flexDirection: "column" }}>
        <div className="mp-kv">
          <span>{t.rate}</span>
          <span className="mp-mono" style={{ fontSize: 14 }}>
            {fmtRateLine(q.rate, q.from, q.to, lang)}
          </span>
        </div>
        {q.vsOfficial ? (
          <div className="mp-kv">
            <span>{t.vsOff}</span>
            <span className="mp-col" style={{ alignItems: "flex-end", gap: 2 }}>
              <span className={gain ? "mp-save" : undefined} style={{ fontSize: 16, fontWeight: 800 }}>
                {fmtPct(q.vsOfficial.pct, lang)}
              </span>
              {saved ? (
                <span className="mp-save" style={{ fontSize: 14 }}>
                  {fill(t.saved, { x: saved })}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
        {q.vsWesternUnion ? (
          <div className="mp-kv">
            <span>{t.vsWU}</span>
            <span className="mp-col" style={{ alignItems: "flex-end", gap: 2 }}>
              <span className={q.vsWesternUnion.pct > 0 ? "mp-save" : undefined} style={{ fontSize: 16, fontWeight: 800 }}>
                {fmtPct(q.vsWesternUnion.pct, lang)}
              </span>
              {BigInt(q.vsWesternUnion.deltaOut) > 0n ? (
                <span className="mp-save" style={{ fontSize: 14 }}>
                  {fill(t.wuMore, { x: fmtSaved(q.vsWesternUnion.deltaOut, q.to, lang) })}
                </span>
              ) : (
                <span className="mp-meta">{t.wuBeforeFee}</span>
              )}
            </span>
          </div>
        ) : null}
        <div className="mp-kv" style={{ flexDirection: "column", gap: 4 }}>
          <span>{t.route}</span>
          <span style={{ fontSize: 16, lineHeight: 1.4, textAlign: "left" }}>{routeText(q, t)}</span>
        </div>
        <div className="mp-kv" style={{ flexDirection: "column", gap: 4 }}>
          <span className="mp-between" style={{ color: "var(--text)" }}>
            <span style={{ color: "var(--muted)" }}>{t.minimum}</span>
            <span className="mp-mono" style={{ fontWeight: 600, fontSize: 14 }}>
              {fmtSym(q.minOut, q.to, lang)}
            </span>
          </span>
          <span className="mp-meta" style={{ textAlign: "left" }}>
            {t.minNote}
          </span>
        </div>
      </div>
    </div>
  );
}

export function QuoteScreen() {
  const { t, lang, screen, ch, go, setSheet, confirmQuote, requestQuote } = useApp();
  const now = useNow();
  const q = ch.quote;
  const expired = screen === "quote-expired" || (q !== null && Date.parse(q.expiresAt) <= now);
  useEffect(() => {
    if (screen === "quote" && expired && !ch.busy) go("quote-expired", { replace: true });
  }, [screen, expired, ch.busy, go]);
  if (!q) return <QuoteLoading />;
  const changed = screen === "quote-changed" && ch.prev;
  const calls = q.usesTextile ? 2 : 1;
  let bar: Parameters<typeof Frame>[0];
  if (screen === "quote-expired") bar = { children: null, primary: { label: t.refresh, onClick: requestQuote }, secondary: { label: t.cancel, onClick: () => go("change") } };
  else if (changed) bar = { children: null, primary: ch.busy ? { label: t.openingMP, kind: "busy" } : { label: t.confirmNew, onClick: confirmQuote }, secondary: { label: t.cancel, onClick: () => go("change") } };
  else bar = { children: null, note: calls > 1 ? fill(t.mpNextN, { n: calls }) : t.mpNext, primary: ch.busy ? { label: t.openingMP, kind: "busy" } : { label: t.confirmMP, onClick: confirmQuote }, secondary: { label: t.alts, onClick: () => go("alts") } };
  return (
    <Frame note={bar.note} primary={bar.primary} secondary={bar.secondary}>
      <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
        {screen === "quote-expired" ? (
          <div className="mp-banner col" role="status">
            <span style={{ fontSize: 17, fontWeight: 700 }}>{t.expired}</span>
            <span style={{ fontSize: 15, lineHeight: 1.45 }}>{t.expiredB}</span>
          </div>
        ) : null}
        {changed && ch.prev ? (
          <div className="mp-banner col" role="status">
            <span style={{ fontSize: 17, fontWeight: 700 }}>{t.changed}</span>
            <span style={{ fontSize: 15, lineHeight: 1.45 }}>
              {fill(t.changedB, { x: fmtSym(q.expectedOut, q.to, lang), d: fmtSym(BigInt(ch.prev.expectedOut) - BigInt(q.expectedOut), q.to, lang) })}
            </span>
          </div>
        ) : null}
        <QuoteCardA q={q} quoteAt={ch.quoteAt} now={now} dim={screen === "quote-expired"} />
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <button type="button" className="mp-link" onClick={() => setSheet("details")}>
            {t.details}
          </button>
          <button type="button" className="mp-link muted" onClick={() => go("change")}>
            {t.cancel}
          </button>
        </div>
      </div>
    </Frame>
  );
}

export function NoMarket() {
  const { t, ch, toast, requestQuote } = useApp();
  return (
    // TODO(contract): "Avisame cuando haya" needs a notify endpoint (e.g. POST /api/miniapp/notify { account, from, to }).
    <Frame primary={{ label: t.notifyMe, onClick: () => toast(t.notifyToast) }} secondary={{ label: t.tryAgain, onClick: requestQuote }}>
      <div className="mp-center" style={{ gap: 16 }}>
        <div className="mp-circle neutral" style={{ width: 56, height: 56, fontSize: 24 }}>
          —
        </div>
        <h1 className="mp-h1 md">{fill(t.noMarket, { a: t.curLower[CUR_OF[ch.from]], b: t.curLower[CUR_OF[ch.to]] })}</h1>
        <p className="mp-p">{t.noMarketB}</p>
        <div className="mp-soft" style={{ fontSize: 15, lineHeight: 1.45 }}>
          {t.noMarketTip}
        </div>
      </div>
    </Frame>
  );
}

export function Alts() {
  const { t, lang, ch, back } = useApp();
  const q = ch.quote;
  if (!q) return null;
  const venue = (v: string[]) => v.map((x) => (x === "uniswap" ? "Uniswap" : "Textile")).join(" + ");
  const rows: { l: string; v: bigint; chosen: boolean }[] = [
    { l: routeText(q, t), v: BigInt(q.expectedOut), chosen: true },
    ...q.alternatives.map((a) => ({ l: fill(t.altOther, { v: venue(a.venues) }), v: BigInt(a.expectedOut), chosen: false })),
    ...(q.vsOfficial ? [{ l: t.altOfficial, v: BigInt(q.expectedOut) - BigInt(q.vsOfficial.deltaOut), chosen: false }] : []),
  ];
  return (
    <Frame primary={{ label: t.backToQuote, onClick: back }}>
      <div className="mp-pad" style={{ gap: 12, paddingTop: 4 }}>
        <p className="mp-p" style={{ fontSize: 16 }}>
          {fill(t.altB, { y: fmtSym(q.amountIn, q.from, lang) })}
        </p>
        {rows.map((r) => (
          <div key={r.l} className="mp-between" style={{ padding: 16, borderRadius: 16, background: "var(--surface)", border: r.chosen ? "2px solid var(--save-text)" : "1px solid var(--hairline)" }}>
            <div className="mp-col">
              <span style={{ fontSize: 16, fontWeight: 600 }}>{r.l}</span>
              {r.chosen ? (
                <span className="mp-tag save" style={{ alignSelf: "flex-start" }}>
                  {t.altChosen}
                </span>
              ) : null}
            </div>
            <span className="mp-tab" style={{ fontSize: 17, fontWeight: 700, whiteSpace: "nowrap" }}>
              {fmtSym(r.v, q.to, lang)}
            </span>
          </div>
        ))}
        <div className="mp-meta">{t.altNote}</div>
      </div>
    </Frame>
  );
}

function payLabel(app: ReturnType<typeof useApp>): string {
  const { exec, lang } = app;
  return exec.from && exec.amountIn ? fmtSym(exec.amountIn, exec.from, lang) : "";
}
function getLabel(app: ReturnType<typeof useApp>, out?: string | null): string {
  const { exec, lang } = app;
  const amount = out ?? exec.expectedOut;
  return exec.to && amount ? fmtSym(amount, exec.to, lang) : "";
}

export function Processing() {
  const app = useApp();
  const { t, exec } = app;
  const st = exec.stage?.stage;
  const sent = st === "sent" || st === "submitting";
  const steps = [
    { l: st === "signing-proof" ? t.pProof : t.pA, done: sent },
    { l: exec.flow === "send" ? fill(t.pS, { n: exec.contactName ?? "" }) : exec.from && exec.to ? fill(t.pB, { a: t.curLower[CUR_OF[exec.from]], b: t.curLower[CUR_OF[exec.to]] }) : t.processing, done: st === "submitting" },
    { l: t.pC, done: false },
  ];
  const active = steps.findIndex((s) => !s.done);
  return (
    <Frame primary={{ label: `${t.processing}…`, kind: "busy" }}>
      <div className="mp-center" style={{ gap: 20 }}>
        <div className="mp-circle soft">
          <Spinner size={26} />
        </div>
        <div className="mp-col" style={{ gap: 6 }}>
          <h1 className="mp-h1">{exec.flow === "send" ? fill(t.pS, { n: exec.contactName ?? "" }) : t.processing}</h1>
          <div className="mp-mono" style={{ fontSize: 15, color: "var(--muted)" }}>
            {payLabel(app)} {getLabel(app) ? `→ ${getLabel(app)}` : ""}
          </div>
        </div>
        <ol className="mp-card pad" style={{ margin: 0, listStyle: "none", gap: 14 }}>
          {steps.map((s, i) => (
            <li key={s.l} className="mp-row">
              <span className={`mp-step-dot ${s.done ? "done" : ""}`}>{s.done ? "✓" : i === active ? <Spinner /> : ""}</span>
              <span style={{ fontSize: 16, color: s.done || i === active ? "var(--text)" : "var(--muted)", fontWeight: i === active ? 700 : 500 }}>{s.l}</span>
            </li>
          ))}
        </ol>
        <p className="mp-p" style={{ fontSize: 15 }}>
          {t.procNote}
        </p>
      </div>
    </Frame>
  );
}

export function ReceiptChip({ receiptId }: { receiptId: string | null }) {
  const { t, api } = useApp();
  const r = useReceipt(api, receiptId);
  return (
    <div className="mp-soft mp-row" style={{ borderStyle: "dashed", borderRadius: 16 }}>
      <div className="mp-grow mp-col" style={{ gap: 3 }}>
        <span className="mp-mono" style={{ fontSize: 14, fontWeight: 600 }}>
          {receiptId ? receiptRef(receiptId) : "#—"}
        </span>
        <span className="mp-meta">{t.receiptSaved}</span>
      </div>
      <ReceiptBadge status={r.data?.status ?? "registering"} t={t} />
    </div>
  );
}

export function Done() {
  const app = useApp();
  const { t, lang, exec, ch, go, openReceipt, api } = app;
  const r = useReceipt(api, exec.receiptId);
  const out = r.data?.amountOut ?? exec.expectedOut;
  const savings = gainOf(r.data?.savings ?? (ch.quote?.vsOfficial && ch.quote.from === exec.from && ch.quote.to === exec.to ? ch.quote.vsOfficial : null));
  return (
    <Frame primary={{ label: t.seeReceipt, onClick: () => (exec.receiptId ? openReceipt(exec.receiptId) : go("receipts")) }} secondary={{ label: t.backHome, onClick: () => go("home") }}>
      <div className="mp-center">
        <div className="mp-circle ok" style={{ fontSize: 32 }}>
          ✓
        </div>
        <div className="mp-col" style={{ gap: 6 }}>
          <h1 className="mp-h1 lg">{fill(t.doneT, { x: getLabel(app, out) })}</h1>
          <div style={{ fontSize: 17, color: "var(--muted)" }}>{fill(t.doneSub, { y: payLabel(app) })}</div>
        </div>
        {savings && exec.to ? (
          <div className="mp-col" style={{ alignSelf: "flex-start", gap: 2, background: "var(--save-bg)", color: "var(--save-text)", borderRadius: 14, padding: "12px 16px" }}>
            <span style={{ fontSize: 20, fontWeight: 800 }}>
              {fmtPct(savings.pct, lang)} {t.vsOff}
            </span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{fill(t.saved, { x: fmtSaved(savings.deltaOut, exec.to, lang) })}</span>
          </div>
        ) : null}
        <ReceiptChip receiptId={exec.receiptId} />
        <MiniPayReceiptLink />
      </div>
    </Frame>
  );
}

const minipayReceipt = (hash: string, celebrate = false) => `https://link.minipay.xyz/receipt?tx=${hash}${celebrate ? "&celebrate" : ""}`;

/** MiniPay's own transaction receipt (deeplink), next to our verifiable receipt. */
export function MiniPayReceiptLink() {
  const { t, exec, openLink, mock, toast } = useApp();
  const hash = exec.result?.kind === "done" ? exec.result.hashes.at(-1) : undefined;
  if (!hash) return null;
  return (
    <button type="button" className="mp-link inline" style={{ alignSelf: "flex-start" }} onClick={() => (mock ? toast(t.toastMP) : openLink(minipayReceipt(hash, true)))}>
      {t.seeInMP} ↗
    </button>
  );
}

export function Failed() {
  const app = useApp();
  const { t, exec, go, requestQuote, requestSendQuote, openLink } = app;
  const res = exec.result;
  const unknown = res?.kind === "failed" && res.reason === "unknown";
  const lastHash = res?.kind === "failed" ? res.hashes.at(-1) : undefined;
  if (unknown)
    return (
      <Frame primary={lastHash ? { label: t.openActivity, onClick: () => openLink(minipayReceipt(lastHash)) } : { label: t.backHome, onClick: () => go("home") }} secondary={lastHash ? { label: t.backHome, onClick: () => go("home") } : null}>
        <div className="mp-center" style={{ gap: 16 }}>
          <div className="mp-circle warn">?</div>
          <h1 className="mp-h1">{t.unknownT}</h1>
          <p className="mp-p ink">{t.unknownB}</p>
        </div>
      </Frame>
    );
  return (
    <Frame primary={{ label: t.newQuote, onClick: exec.flow === "send" ? requestSendQuote : requestQuote }} secondary={{ label: t.backHome, onClick: () => go("home") }}>
      <div className="mp-center" style={{ gap: 16 }}>
        <div className="mp-circle bad">✕</div>
        <h1 className="mp-h1">{t.failedT}</h1>
        <NoMoneyMoved t={t} />
        <p className="mp-p ink">{fill(t.failedB, { y: payLabel(app) })}</p>
        <p className="mp-p" style={{ fontSize: 15 }}>
          {res?.kind === "failed" && res.reason === "not-sent" ? t.notSent : t.failedWhy}
        </p>
      </div>
    </Frame>
  );
}

export function Cancelled() {
  const app = useApp();
  const { t, exec, go, requestQuote, requestSendQuote } = app;
  return (
    <Frame primary={{ label: t.backToQuote, onClick: exec.flow === "send" ? requestSendQuote : requestQuote }} secondary={{ label: t.backHome, onClick: () => go("home") }}>
      <div className="mp-center" style={{ gap: 16 }}>
        <div className="mp-circle neutral" style={{ fontSize: 28 }}>
          ↺
        </div>
        <h1 className="mp-h1">{t.cancelT}</h1>
        <NoMoneyMoved t={t} />
        <p className="mp-p ink">{fill(t.cancelB, { y: payLabel(app) })}</p>
      </div>
    </Frame>
  );
}

export function TgQuote() {
  const { t } = useApp();
  return (
    <Frame primary={{ label: t.openingMP, kind: "busy" }}>
      <div className="mp-center" style={{ gap: 16 }}>
        <div className="mp-circle soft">
          <Spinner size={26} />
        </div>
        <h1 className="mp-h1">{t.tgQuoteT}</h1>
        <p className="mp-p">{t.tgQuoteB}</p>
      </div>
    </Frame>
  );
}
