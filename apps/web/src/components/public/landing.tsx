import type { ReactNode } from "react";
import { bundleHash } from "@arbolito/proof";
import { LOCALE, messages, withLang, type Lang } from "../../i18n/messages";
import { anchorFor } from "../../lib/cached";
import type { ReceiptRecord } from "../../lib/data";
import { fiatPrefix, formatBps, formatFixed, formatMoney, formatRate, RATE_ONE, type Locale } from "../../lib/format";
import { computeMetrics } from "../../lib/metrics";
import { buildReceiptView, resolveRate, type ReceiptView } from "../../lib/receipt-view";
import { Calculator } from "./calculator";
import { HeroQuote } from "./hero-quote";
import { MINIPAY_URL, TELEGRAM_URL } from "./links";
import { ProofCheck } from "./proof-check";
import { pickShowcase } from "./public-data";
import { calcRows, liveReferences, type CalcRows } from "./rates";
import { Display, Kicker } from "./shell";

const TZ = "America/Argentina/Buenos_Aires";

const money = (amount: bigint, decimals: number, fiat: string, locale: Locale) => formatMoney(amount, decimals, fiat, locale);
const whole = (amount: bigint, decimals: number, fiat: string, locale: Locale) => `${fiatPrefix(fiat)} ${formatFixed(amount, decimals, locale, { dp: 0 })}`;
const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const dayMonth = (iso: string, locale: Locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: TZ }).format(new Date(iso));
const clock = (iso: string, locale: Locale) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date(iso));

function ticketDate(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: TZ })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}.${p.month}.${p.year} · ${p.hour}:${p.minute}:${p.second}`;
}

const routePath = (v: ReceiptView) => [v.chosen.steps[0]?.from.fiat ?? v.tokenIn.fiat, ...v.chosen.steps.map((s) => s.to.fiat)].map(fiatPrefix).join(" → ");

// ─────────────────────────────────────────────────────────────── hero

async function LiveLine({ lang }: { lang: Lang }) {
  const t = messages(lang).landing.hero;
  const live = await liveReferences();
  if (!live) return null;
  return (
    <span className="live-dot">
      {t.live} · {t.updated(clock(live.at, LOCALE[lang]))}
    </span>
  );
}

export async function Ticker({ lang }: { lang: Lang }) {
  const t = messages(lang);
  const locale = LOCALE[lang];
  const live = await liveReferences();
  const items: string[] = [];
  if (live) {
    const refs = live.references;
    const num = (rate: bigint) => formatFixed(rate, 18, locale, { dp: rate >= 1000n * RATE_ONE ? 0 : 2 });
    const market = (base: string) => resolveRate(refs, "uniswap_mid", base, "ARS") ?? resolveRate(refs, "textile_mid", base, "ARS");
    const usd = market("USD");
    const brl = market("BRL");
    if (usd) items.push(`1 US$ = ARS ${num(usd.rate)} · ${t.landing.hero.tickerMarket}`);
    if (brl) items.push(`1 R$ = ARS ${num(brl.rate)} · ${t.landing.hero.tickerMarket}`);
    for (const name of ["official", "mep", "ccl", "blue", "crypto"] as const) {
      const hit = resolveRate(refs, name, "USD", "ARS");
      if (hit) items.push(`${t.receipt.refShort[name]} ${num(hit.rate)}`);
    }
  }
  items.push(t.landing.hero.tickerProof);
  if (!live) items.unshift(t.landing.hero.tickerWaiting);
  return <TickerBand items={items} />;
}

export function TickerBand({ items }: { items: string[] }) {
  return (
    <div className="ticker">
      <div className="ticker-track">
        {[0, 1].map((copy) => (
          <div className="ticker-copy" key={copy} aria-hidden={copy === 1 ? "true" : undefined}>
            {items.map((k) => (
              <span key={k}>{k}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The real receipt as the hero card: shown while live rates load, or when they are down. */
export function ReceiptFloat({ lang, showcase }: { lang: Lang; showcase?: ReceiptRecord }) {
  const t = messages(lang).landing.hero;
  const locale = LOCALE[lang];
  if (!showcase) return null;
  const v = buildReceiptView(showcase.bundle);
  return (
    <a className="card glass float-card bob" href={withLang(`/r/${showcase.id}`, lang)}>
      <span className="float-label mono">{t.cardLabel(dayMonth(v.createdAt, locale))}</span>
      <span className="amount-xl">{money(v.amountOut, v.tokenOut.decimals, v.tokenOut.fiat, locale)}</span>
      <span className="muted">
        {t.cardFor(money(v.amountIn, v.tokenIn.decimals, v.tokenIn.fiat, locale))}
        {v.savings && v.savings.bps > 0 && (
          <>
            {" · "}
            <b className="tag-lime">{formatBps(v.savings.bps, locale)}</b> {t.vsOfficial}
          </>
        )}
      </span>
    </a>
  );
}

/** The design's live quote card: R$ 10 at the market rate right now, against the official rate. */
export async function LiveQuote({ lang, showcase }: { lang: Lang; showcase?: ReceiptRecord }) {
  const t = messages(lang).landing.hero;
  const locale = LOCALE[lang];
  const live = await liveReferences();
  const rows = live ? calcRows(live.references).BRL : [];
  const ours = rows.find((r) => r.key === "arbolito");
  const off = rows.find((r) => r.key === "official");
  if (!ours || !off) return <ReceiptFloat lang={lang} showcase={showcase} />;
  const a = BigInt(ours.rate);
  const o = BigInt(off.rate);
  const bps = o === 0n ? 0n : ((a - o) * 10_000n) / o;
  return (
    <HeroQuote
      label={t.quoteLabel}
      expires={t.quoteExpires}
      amount={money(10n * a, 18, "ARS", locale)}
      sub={t.quoteFor(money(10n * 10n ** 18n, 18, "BRL", locale))}
      pct={bps > 0n ? `${formatBps(bps, locale)} ${t.vsOfficial}` : null}
    />
  );
}

export function Hero({ lang, showcase, live, ticker, quote }: { lang: Lang; showcase?: ReceiptRecord; live: ReactNode; ticker: ReactNode; quote: ReactNode }) {
  const t = messages(lang).landing.hero;
  const locale = LOCALE[lang];
  const v = showcase ? buildReceiptView(showcase.bundle) : undefined;
  return (
    <section id="hero" className="hero">
      <div className="hero-inner">
        <div className="hero-meta mono">
          <span>{t.currencies}</span>
          {live}
        </div>
        <Display as="h1" a={t.titleA} b={t.titleB} c={t.titleC} accent="pink" className="hero-title" />
        <div className="hero-bottom">
          <div className="hero-copy">
            <p className="hero-lead">{t.lead}</p>
            <div className="cta-row">
              <a className="btn btn-primary btn-lg" href={MINIPAY_URL} rel="noopener">
                {t.ctaMiniPay}
              </a>
              <a className="hero-tg" href={TELEGRAM_URL} rel="noopener">
                {t.telegramHint}
              </a>
            </div>
          </div>
          {v && showcase && (
            <div className="hero-cards">
              {quote}
              <a className="card glass float-card float-proof bob bob-late" href={withLang(`/r/${showcase.id}#verificacion`, lang)}>
                <span className="check-dot" aria-hidden="true">
                  ✓
                </span>
                <span className="float-proof-text">
                  <b>{t.proofTitle}</b>
                  <span className="mono muted">{t.proofSub(shortHash(bundleHash(showcase.bundle)))}</span>
                </span>
              </a>
            </div>
          )}
        </div>
      </div>
      {ticker}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────── 01 cómo funciona

export function Steps({ lang, showcase }: { lang: Lang; showcase?: ReceiptRecord }) {
  const t = messages(lang).landing.como;
  const locale = LOCALE[lang];
  const v = showcase ? buildReceiptView(showcase.bundle) : undefined;
  return (
    <section id="como" className="section">
      <div className="section-inner">
        <div className="section-head">
          <Kicker>{t.kicker}</Kicker>
          <Display a={t.titleA} b={t.titleB} c={t.titleC} />
        </div>
        <ol className="steps-grid">
          <li className="card glass step">
            <span className="step-n accent-pink">1</span>
            <h3>{t.s1.t}</h3>
            <p className="muted">{t.s1.d}</p>
            <div className="bubbles">
              <span className="bubble">{t.bubble1}</span>
              <span className="bubble bubble-voice">{t.bubble2}</span>
            </div>
          </li>
          <li className="card glass step step-stagger-1">
            <span className="step-n accent-blue">2</span>
            <h3>{t.s2.t}</h3>
            <p className="muted">{t.s2.d}</p>
            {v && (
              <div className="step-quote">
                <span className="amount-l">{money(v.amountOut, v.tokenOut.decimals, v.tokenOut.fiat, locale)}</span>
                <span className="muted">
                  {t.s2For(money(v.amountIn, v.tokenIn.decimals, v.tokenIn.fiat, locale))}
                  {v.savings ? ` · ${t.s2Vs(formatBps(v.savings.bps, locale))}` : ""}
                </span>
                <span className="timer" aria-hidden="true">
                  <span />
                </span>
              </div>
            )}
          </li>
          <li className="card glass step step-stagger-2">
            <span className="step-n accent-pink">3</span>
            <h3>{t.s3.t}</h3>
            <p className="muted">{t.s3.d}</p>
            <div className="illo illo-step">
              <img src="/landing/ref-exchange.jpg" alt={t.s3Alt} width={1199} height={799} loading="lazy" decoding="async" />
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────── 02 calculadora

function notesFor(rows: CalcRows, lang: Lang, template: string, time: string): Record<"USD" | "BRL", string> {
  const t = messages(lang).landing.calc;
  const locale = LOCALE[lang];
  const note = (cur: "USD" | "BRL") => {
    const ours = rows[cur].find((r) => r.key === "arbolito");
    const off = rows[cur].find((r) => r.key === "official");
    if (!ours || !off) return "";
    const a = BigInt(ours.rate);
    const o = BigInt(off.rate);
    const bps = o === 0n ? 0n : ((a - o) * 10_000n) / o;
    return `${template.replace("{t}", time).replace("{u}", t.unit[cur]).replace("{p}", formatBps(bps, locale))} ${t.noteFees}`;
  };
  return { USD: note("USD"), BRL: note("BRL") };
}

export async function CalcBody({ lang, fallback }: { lang: Lang; fallback?: ReceiptRecord }) {
  const t = messages(lang).landing.calc;
  const locale = LOCALE[lang];
  const live = await liveReferences();
  let rows = live ? calcRows(live.references) : { USD: [], BRL: [] };
  let notes: Record<"USD" | "BRL", string>;
  if (rows.USD.length || rows.BRL.length) {
    notes = notesFor(rows, lang, t.noteLive, clock(live!.at, locale));
  } else if (fallback) {
    // Every live source is down: use the rates recorded in the latest receipt, and say so.
    rows = calcRows(fallback.bundle.references);
    notes = notesFor(rows, lang, t.noteReceipt, new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(new Date(fallback.bundle.createdAt)));
  } else {
    notes = { USD: "", BRL: "" };
  }
  if (!rows.USD.length && !rows.BRL.length) return <p className="card glass empty-note">{t.unavailable}</p>;
  return (
    <Calculator
      locale={locale}
      rows={rows}
      notes={notes}
      labels={{ pre: t.pre, mid: t.mid, more: t.more, less: t.less, have: t.have, usd: t.usd, brl: t.brl, amount: t.amount, sources: t.sources, rows: t.rows }}
    />
  );
}

export function CalcSection({ lang, children }: { lang: Lang; children: ReactNode }) {
  const t = messages(lang).landing.calc;
  return (
    <section id="calc" className="section">
      <div className="section-inner">
        <div className="section-head section-head-end">
          <Kicker>{t.kicker}</Kicker>
          <Display a={t.titleA} b={t.titleB} />
        </div>
        {children}
      </div>
    </section>
  );
}

export function CalcSkeleton({ lang }: { lang: Lang }) {
  return <p className="card glass empty-note skeleton">{messages(lang).landing.calc.loading}</p>;
}

// ─────────────────────────────────────────────────────────────── 03 la prueba

export function Ticket({ rec, lang }: { rec: ReceiptRecord; lang: Lang }) {
  const t = messages(lang).landing.recibo;
  const locale = LOCALE[lang];
  const v = buildReceiptView(rec.bundle);
  const saved = v.savings && v.savings.delta > 0n ? v.savings.delta : undefined;
  const rows: [string, string, boolean?][] = [
    [t.paid, money(v.amountIn, v.tokenIn.decimals, v.tokenIn.fiat, locale)],
    [t.got, money(v.amountOut, v.tokenOut.decimals, v.tokenOut.fiat, locale), true],
    [t.rate, formatRate(v.rate >= RATE_ONE ? v.rate : v.rate === 0n ? 0n : (RATE_ONE * RATE_ONE) / v.rate, locale)],
    ...(v.savings ? [[t.vsOff, formatBps(v.savings.bps, locale)] as [string, string]] : []),
    [t.route, routePath(v)],
    [t.fee, formatFixed(0n, 2, locale, { dp: 2 })],
  ];
  return (
    <div className="ticket">
      <div className="ticket-head">
        <span className="ticket-brand">arbolito</span>
        <span>
          {t.receipt.toUpperCase()} #{v.routeId.slice(0, 4).toUpperCase()}-{v.routeId.slice(4, 8).toUpperCase()}
        </span>
        <span className="ticket-faint">{ticketDate(v.createdAt)}</span>
      </div>
      <dl className="ticket-rows">
        {rows.map(([k, val, strong]) => (
          <div key={k}>
            <dt>{k.toUpperCase()}</dt>
            <dd className={strong ? "strong" : undefined}>{val}</dd>
          </div>
        ))}
      </dl>
      <div className="ticket-foot">
        <span className="ticket-faint">{(saved ? t.saved : t.got).toUpperCase()}</span>
        <span className="ticket-total">{saved ? whole(saved, v.tokenOut.decimals, v.tokenOut.fiat, locale) : money(v.amountOut, v.tokenOut.decimals, v.tokenOut.fiat, locale)}</span>
      </div>
    </div>
  );
}

export async function ProofBody({ lang, rec }: { lang: Lang; rec: ReceiptRecord }) {
  const t = messages(lang).landing.recibo;
  const locale = LOCALE[lang];
  const hash = bundleHash(rec.bundle);
  const anchor = await anchorFor(rec, hash);
  const block = anchor?.blockNumber ? formatFixed(BigInt(anchor.blockNumber), 0, locale, { dp: 0 }) : null;
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: TZ }).format(new Date(rec.bundle.createdAt));
  return (
    <ProofCheck
      bundleUrl={`/r/${rec.id}/bundle.json`}
      registeredHash={anchor ? hash : null}
      block={block}
      receiptHref={withLang(`/r/${rec.id}`, lang)}
      labels={{
        idleTitle: t.idleTitle,
        idleSub: t.idleSub,
        runTitle: t.runTitle,
        okTitle: t.okTitle,
        okSub: t.okSub.replace("{d}", date),
        badTitle: t.badTitle,
        badSub: t.badSub,
        unknownTitle: t.unknownTitle,
        unknownSub: t.unknownSub,
        local: t.local,
        registered: t.registered,
        notRegistered: t.notRegistered,
        tap: t.tap,
        cta: t.cta,
        ctaRun: t.ctaRun,
        ctaAgain: t.ctaAgain,
        error: t.error,
        open: t.open,
      }}
    />
  );
}

export function ReceiptSection({ lang, rec, proof }: { lang: Lang; rec?: ReceiptRecord; proof: ReactNode }) {
  const t = messages(lang).landing.recibo;
  const locale = LOCALE[lang];
  const v = rec ? buildReceiptView(rec.bundle) : undefined;
  const saved = v?.savings && v.savings.delta > 0n ? whole(v.savings.delta, v.tokenOut.decimals, v.tokenOut.fiat, locale) : undefined;
  return (
    <section id="recibo" className="section">
      <div className="section-inner">
        <div className="section-head section-head-center">
          <Kicker>{t.kicker}</Kicker>
          <Display a={t.titleA} b={t.titleB} c={t.titleC} accent="pink" className="narrow" />
        </div>
        {rec ? (
          <div className="proof-grid">
            <Ticket rec={rec} lang={lang} />
            <div className="proof-col">
              {proof}
              <p className="muted proof-story">{saved ? t.story(saved) : t.storyPlain}</p>
            </div>
          </div>
        ) : (
          <p className="card glass empty-note">{t.empty}</p>
        )}
      </div>
    </section>
  );
}

export function ProofSkeleton({ lang }: { lang: Lang }) {
  return <div className="card glass empty-note skeleton">{messages(lang).landing.recibo.loading}</div>;
}

// ─────────────────────────────────────────────────────────────── 04 en vivo

export function Numbers({ lang, records, deskFills }: { lang: Lang; records: ReceiptRecord[]; deskFills?: number }) {
  const t = messages(lang).landing.numeros;
  const locale = LOCALE[lang];
  const m = computeMetrics(records);
  const latest = m.receipts[0];
  const tiles: { k: string; v: string; proof: string; href: string; soon?: boolean }[] = [
    { k: t.wallets, v: String(m.wallets.length), proof: t.pWallets, href: withLang("/metrics#wallets", lang) },
    {
      k: t.ops,
      v: String(m.executionTxs.length),
      proof: latest ? t.pLast(latest.id.slice(0, 8)) : t.pWallets,
      href: latest ? withLang(`/r/${latest.id}`, lang) : withLang("/metrics#receipts", lang),
    },
    { k: t.median, v: m.savingsArs.medianBps === undefined ? "—" : formatBps(m.savingsArs.medianBps, locale), proof: t.pCalc, href: withLang("/metrics#receipts", lang) },
    ...(["ARS", "BRL"] as const).map((fiat) => {
      const vol = m.volumeByToken.find((x) => x.token.fiat === fiat);
      return { k: fiat === "ARS" ? t.volArs : t.volBrl, v: vol ? whole(vol.amount, vol.token.decimals, fiat, locale) : whole(0n, 0, fiat, locale), proof: t.pVolume, href: withLang("/metrics#by-token", lang) };
    }),
    { k: t.volume, v: formatMoney(m.totalUsdMicros, 6, "USD", locale), proof: t.pVolume, href: withLang("/metrics#by-token", lang) },
    { k: t.receipts, v: String(m.receipts.length), proof: t.pVerify, href: latest ? withLang(`/r/${latest.id}#verificacion`, lang) : withLang("/metrics#receipts", lang) },
    deskFills === undefined
      ? { k: t.desk, v: t.soon, proof: t.pDesk, href: withLang("/desk", lang), soon: true }
      : { k: t.deskFills, v: String(deskFills), proof: t.pDesk, href: withLang("/desk", lang) },
  ];
  return (
    <section id="numeros" className="section section-dark">
      <div className="section-inner">
        <div className="numbers-head">
          <div className="section-head">
            <Kicker className="on-dark">{t.kicker}</Kicker>
            <Display a={t.titleA} b={t.titleB} accent="lime" />
          </div>
          <span className="live-dot live-dot-lime mono">{t.refresh}</span>
        </div>
        <div className="tile-grid">
          {tiles.map((x) => (
            <a key={x.k} href={x.href} className={x.soon ? "tile tile-soon" : "tile"}>
              <span className="tile-k mono">{x.k}</span>
              <span className="tile-v">{x.v}</span>
              <span className="tile-proof mono">{x.proof} ↗</span>
            </a>
          ))}
        </div>
        <a className="text-link on-dark" href={withLang("/metrics", lang)}>
          {t.all}
        </a>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────── 05 confianza

export function Trust({ lang }: { lang: Lang }) {
  const t = messages(lang).landing.trust;
  return (
    <section id="confianza" className="section">
      <div className="section-inner">
        <div className="section-head">
          <Kicker>{t.kicker}</Kicker>
          <Display a={t.titleA} b={t.titleB} />
        </div>
        <ol className="trust-list">
          {t.items.map((s, i) => (
            <li key={s.t}>
              <span className="trust-n mono">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{s.t}</h3>
                <p className="muted">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="illo illo-trust">
          <img src="/landing/ref-counter.png" alt={t.illoAlt} width={573} height={568} loading="lazy" decoding="async" />
          <svg className="spin-badge" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
            <circle cx="100" cy="100" r="96" />
            <defs>
              <path id="lpc" d="M100,100 m-70,0 a70,70 0 1,1 140,0 a70,70 0 1,1 -140,0" />
            </defs>
            <text>
              <textPath href="#lpc">{t.badge}</textPath>
            </text>
          </svg>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────── 06 preguntas

export function Faq({ lang }: { lang: Lang }) {
  const t = messages(lang).landing.faq;
  return (
    <section id="faq" className="section">
      <div className="section-inner section-inner-narrow">
        <div className="section-head section-head-center">
          <Kicker>{t.kicker}</Kicker>
          <h2 className="display display-s">{t.title}</h2>
        </div>
        <div className="faq-list">
          {t.items.map((f, i) => (
            <details key={f.q} className="card glass faq-item" name="faq" open={i === 0}>
              <summary>
                <span>{f.q}</span>
                <span className="faq-plus" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="muted">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export { LiveLine, pickShowcase };
