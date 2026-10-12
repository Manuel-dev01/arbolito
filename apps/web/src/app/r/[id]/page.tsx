import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bundleHash } from "@arbolito/proof";
import { ExtLink, Shell } from "../../../components/public/shell";
import { VerifyPanel } from "../../../components/public/verify-panel";
import { getLang, LOCALE, messages, withLang, type Lang, type Messages } from "../../../i18n/messages";
import { anchorFor, getReceiptCached, verifyReceipt } from "../../../lib/cached";
import { PUBLIC_RPC_URL, RECEIPTS_ADDRESS } from "../../../lib/chain";
import { fiatPrefix, formatBps, formatFixed, formatMoney, formatRate, formatToken, RATE_ONE, shortHex, type Locale } from "../../../lib/format";
import { buildReceiptView, type ReceiptView, type RouteView, type StepView, type TokenRef } from "../../../lib/receipt-view";
import { addressUrl, blockUrl, txUrl } from "../../../lib/receipts-abi";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TZ = "America/Argentina/Buenos_Aires";
/** A receipt younger than this whose hash is not anchored yet is "Registrando", not "No coincide". */
const PENDING_WINDOW_MS = 15 * 60_000;

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const lang = getLang(sp.lang);
  const rec = await getReceiptCached(id);
  if (!rec) return { title: messages(lang).story.eyebrow };
  const v = buildReceiptView(rec.bundle);
  const l = LOCALE[lang];
  const title = `${formatMoney(v.amountIn, v.tokenIn.decimals, v.tokenIn.fiat, l)} → ${formatMoney(v.amountOut, v.tokenOut.decimals, v.tokenOut.fiat, l)}`;
  return { title, description: messages(lang).verify.lead, robots: rec.supersededBy ? { index: false } : undefined };
}

const money = (amount: bigint, t: TokenRef, locale: Locale, signed = false) => formatMoney(amount, t.decimals, t.fiat, locale, { signed });

/** "1 BRL = 317,74 ARS", flipped when the rate is below 1 so it stays readable (1 USD = 1.540 ARS, not 1 ARS = 0,00065 USD). */
function rateText(rate: bigint, from: TokenRef, to: TokenRef, locale: Locale, t: Messages["receipt"]): string {
  if (rate === 0n) return "—";
  if (rate >= RATE_ONE || from.fiat === to.fiat) return t.rateLine(fiatPrefix(from.fiat), formatRate(rate, locale), to.fiat);
  return t.rateLine(fiatPrefix(to.fiat), formatRate((RATE_ONE * RATE_ONE) / rate, locale), from.fiat);
}

function poolFee(fee: number, locale: Locale): string {
  const pct = formatFixed(BigInt(fee), 4, locale, { dp: 4, minDp: 2 });
  return locale === "en-US" ? `${pct}%` : `${pct} %`;
}

function Route({ route, lang, chosen }: { route: RouteView; lang: Lang; chosen?: boolean }) {
  const t = messages(lang).receipt;
  const locale = LOCALE[lang];
  const first = route.steps[0];
  const venueNote = (s: StepView) => [s.fee !== undefined ? t.poolFee(poolFee(s.fee, locale)) : null, s.venue !== "uniswap_v3" && !s.firm ? t.indicative : null].filter(Boolean).join(" · ");
  return (
    <div className="route" aria-label={route.label}>
      {first && (
        <span className="hop">
          <strong>{money(first.amountIn, first.from, locale)}</strong>
          <span>{first.from.symbol}</span>
        </span>
      )}
      {route.steps.map((s, i) => (
        <span key={i} style={{ display: "contents" }}>
          <span className="via">
            <span>{t.venue[s.venue]}</span>
            {venueNote(s) && <span>{venueNote(s)}</span>}
          </span>
          <span className="hop">
            <strong>{money(s.amountOut, s.to, locale)}</strong>
            <span>
              {s.to.symbol}
              {chosen && i === route.steps.length - 1 ? ` · ${t.quoted}` : ""}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

type BadgeState = "verified" | "pending" | "mismatch" | "unavailable" | "superseded";

function badgeState(superseded: boolean, createdAt: string, server: Awaited<ReturnType<typeof verifyReceipt>>): BadgeState {
  if (superseded) return "superseded";
  const r = server.result;
  if (r?.ok) return "verified";
  const fresh = Date.now() - Date.parse(createdAt) < PENDING_WINDOW_MS;
  if (r) return !r.anchor && fresh ? "pending" : "mismatch";
  return fresh ? "pending" : "unavailable";
}

const BADGE_ICON: Record<BadgeState, string> = { verified: "✓", pending: "…", mismatch: "!", unavailable: "…", superseded: "!" };

/** "Cómo se compara": what each reference would have paid, as bars, with Arbolito first. */
function Comparison({ v, lang }: { v: ReceiptView; lang: Lang }) {
  const t = messages(lang);
  const locale = LOCALE[lang];
  const rows = [
    { key: "arbolito", name: t.story.arbolito, rate: v.rate, value: v.amountOut, me: true, delta: 0n, bps: 0, source: undefined as string | undefined, via: undefined as string | undefined },
    ...v.comparisons.map((c) => ({
      key: c.name,
      name: t.receipt.refName[c.name],
      rate: c.rate,
      value: c.referenceOut,
      me: false,
      delta: c.delta,
      bps: c.bps,
      source: c.source,
      via: c.via ? t.receipt.via(c.via.pair, t.receipt.refShort[c.via.name]) : undefined,
    })),
  ];
  const max = rows.reduce((a, r) => (r.value > a ? r.value : a), 0n);
  const min = (rows.reduce((a, r) => (r.value < a ? r.value : a), max) * 9n) / 10n;
  const width = (x: bigint) => (max === min ? 100 : Number(((x - min) * 10_000n) / (max - min)) / 100);
  return (
    <section className="card" aria-labelledby="cmp-title">
      <div className="card-head">
        <h2 className="h2" id="cmp-title">
          {t.story.compareTitle}
        </h2>
        <p className="lead">{t.story.compareLead}</p>
      </div>
      <ul className="cmp-list">
        {rows.map((r) => (
          <li key={r.key} className={r.me ? "cmp-row cmp-me" : "cmp-row"}>
            <div className="cmp-line">
              <span className="cmp-name">{r.name}</span>
              <span className="cmp-rate mono">{rateText(r.rate, v.tokenIn, v.tokenOut, locale, t.receipt)}</span>
            </div>
            <span className="cmp-track" aria-hidden="true">
              <span className="cmp-fill" style={{ width: `${width(r.value)}%` }} />
            </span>
            <div className="cmp-meta">
              <span>
                {money(r.value, v.tokenOut, locale)}
                {!r.me && (
                  <>
                    {" · "}
                    <span className={r.delta >= 0n ? "pos" : "neg"}>
                      {money(r.delta, v.tokenOut, locale, true)} ({formatBps(r.bps, locale)})
                    </span>
                  </>
                )}
              </span>
              {r.source && (
                <span>
                  {r.via ? `${r.via} · ` : ""}
                  {r.source.startsWith("http") ? (
                    <ExtLink href={r.source}>{t.receipt.source} ↗</ExtLink>
                  ) : (
                    <span className="mono" title={r.source}>
                      {shortHex(r.source, 18, 9)}
                    </span>
                  )}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!v.savings && (
        <p className="small muted" style={{ marginTop: 14 }}>
          {t.receipt.noOfficial}
        </p>
      )}
    </section>
  );
}

export default async function ReceiptPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const lang = getLang(sp.lang);
  const locale = LOCALE[lang];
  const m = messages(lang);
  const t = m.receipt;
  const s = m.story;
  const rec = await getReceiptCached(id);
  if (!rec) notFound();

  const v = buildReceiptView(rec.bundle);
  const hash = bundleHash(rec.bundle);
  const [verification, anchorLookup] = await Promise.all([verifyReceipt(hash, rec.bundle), anchorFor(rec, hash)]);
  const anchor = verification.result?.anchor ?? anchorLookup;
  const state = badgeState(!!rec.supersededBy, v.createdAt, verification);

  const short = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(v.createdAt));
  const long = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "long", timeZone: TZ }).format(new Date(v.createdAt));
  const officialPair = v.savings?.pair ?? `${v.tokenIn.fiat}/${v.tokenOut.fiat}`;
  const officialFiat = officialPair.split("/")[1] ?? v.tokenOut.fiat;
  const savedAbs = v.savings ? (v.savings.delta < 0n ? -v.savings.delta : v.savings.delta) : 0n;
  const fiats = [v.chosen.steps[0]?.from.fiat ?? v.tokenIn.fiat, ...v.chosen.steps.map((x) => x.to.fiat)];
  const path = fiats.map((f) => s.fiatName[f] ?? f).join(" → ");

  return (
    <Shell lang={lang} path={`/r/${rec.id}`}>
      {rec.supersededBy && (
        <div className="notice warn" role="status">
          {t.supersededBefore}
          <a href={withLang(`/r/${rec.supersededBy}`, lang)}>{t.correctedVersion}</a>
          {t.supersededAfter}
        </div>
      )}
      {rec.supersedes && (
        <div className="notice info">
          {t.supersedesBefore}
          <a href={withLang(`/r/${rec.supersedes}`, lang)}>{t.earlierVersion}</a>
          {t.supersedesAfter}
        </div>
      )}

      <section className="card glass rc-hero" aria-labelledby="receipt-title">
        <div className="rc-top">
          <span className="kicker" id="receipt-title">
            {s.eyebrow} · <time dateTime={v.createdAt}>{long}</time>
          </span>
          <a href="#verificacion" className={`vtag vtag-${state}`}>
            {s.tag[state]}
          </a>
        </div>
        {v.savings && v.savings.delta > 0n ? (
          <>
            <span className="rc-label">{s.saved}</span>
            <span className="rc-amount">{formatMoney(savedAbs, v.tokenOut.decimals, officialFiat, locale)}</span>
            <span className="rc-sub">
              {s.savedVs(officialPair)} · {formatBps(v.savings.bps, locale)}
            </span>
          </>
        ) : (
          <>
            <span className="rc-label">{s.got}</span>
            <span className="rc-amount rc-amount-plain">{money(v.amountOut, v.tokenOut, locale)}</span>
            <span className="rc-sub">
              {v.savings ? s.lessVs(formatMoney(savedAbs, v.tokenOut.decimals, officialFiat, locale), officialPair) : s.noOfficialShort}
            </span>
          </>
        )}
        <span className="rc-sub">
          {money(v.amountIn, v.tokenIn, locale)} → {money(v.amountOut, v.tokenOut, locale)} · {short}
        </span>
        <div className="pair-tiles">
          <div className="pair-tile">
            <span className="muted">{s.paid}</span>
            <b>{money(v.amountIn, v.tokenIn, locale)}</b>
            <span className="mono">{formatToken(v.amountIn, v.tokenIn.decimals, v.tokenIn.symbol, locale)}</span>
          </div>
          <div className="pair-tile">
            <span className="muted">{s.got}</span>
            <b>{money(v.amountOut, v.tokenOut, locale)}</b>
            <span className="mono">{formatToken(v.amountOut, v.tokenOut.decimals, v.tokenOut.symbol, locale)}</span>
          </div>
        </div>
        <span className="rc-sub">
          {t.rateTitle}: <span className="mono">{rateText(v.rate, v.tokenIn, v.tokenOut, locale, t)}</span>
        </span>
      </section>

      <Comparison v={v} lang={lang} />

      <section className="card" aria-labelledby="route-title">
        <div className="card-head">
          <h2 className="h2" id="route-title">
            {s.routeTitle}
          </h2>
          <p className="lead">
            {s.routeSteps(v.chosen.steps.length, path)} {t.routeLead(v.quotesConsidered)}
          </p>
        </div>
        <span className="chosen-tag">✓ {v.chosen.label}</span>
        <Route route={v.chosen} lang={lang} chosen />
        <p className="small muted">
          {t.minOut}: {money(v.chosen.minOut, v.tokenOut, locale)}
        </p>

        <h3 style={{ marginTop: 22, fontSize: 18, fontWeight: 800 }}>{t.altTitle}</h3>
        {v.alternatives.length === 0 && <p className="small muted">{t.altNone}</p>}
        {v.alternatives.map((a) => (
          <div className="alt" key={a.id}>
            <div className="alt-top">
              <span className="mono muted">{a.label}</span>
              <span className={a.diffVsChosen >= 0n ? "pos" : "neg"}>
                {money(a.diffVsChosen, v.tokenOut, locale, true)} ({formatBps(a.diffBps, locale)})
              </span>
            </div>
            <Route route={a} lang={lang} />
            {a.diffVsChosen > 0n && a.steps.some((x) => x.venue !== "uniswap_v3" && !x.firm) && <p className="small muted">{t.altBetterNote}</p>}
          </div>
        ))}
      </section>

      <section className="card glass stack-16" id="verificacion" aria-labelledby="verif-title">
        <h2 className="h2" id="verif-title">
          {s.verifyTitle}
        </h2>
        <details className="details-card vdetails" id="detalles">
          <summary className={`vbadge vbadge-${state}`}>
            <span className="vbadge-icon" aria-hidden="true">
              {BADGE_ICON[state]}
            </span>
            <span className="vbadge-text">
              <b>{s.badge[state].t}</b>
              <span>{s.badge[state].d}</span>
              <u>{s.details}</u>
            </span>
          </summary>
          <div className="details-body">
            <p className="muted small">{s.detailsLead}</p>

            <div>
              <h3>{t.txTitle}</h3>
              <dl className="kv">
                <dt>{s.fingerprint} (keccak256)</dt>
                <dd className="mono">{hash}</dd>
                <dt>{t.execTx}</dt>
                <dd>
                  <ExtLink href={txUrl(v.execution.txHash)} className="mono">
                    {shortHex(v.execution.txHash, 10, 8)} ↗
                  </ExtLink>{" "}
                  <span className="small muted">
                    {t.block} <ExtLink href={blockUrl(v.execution.blockNumber)}>{v.execution.blockNumber.toString()}</ExtLink>
                  </span>
                </dd>
                <dt>{t.anchorTx}</dt>
                <dd>
                  {anchor ? (
                    <>
                      <ExtLink href={txUrl(anchor.txHash)} className="mono">
                        {shortHex(anchor.txHash, 10, 8)} ↗
                      </ExtLink>{" "}
                      {anchor.blockNumber && (
                        <span className="small muted">
                          {t.block} <ExtLink href={blockUrl(anchor.blockNumber)}>{anchor.blockNumber}</ExtLink>
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="muted">{t.unknown}</span>
                  )}
                </dd>
                {RECEIPTS_ADDRESS && (
                  <>
                    <dt>{t.contract}</dt>
                    <dd>
                      <ExtLink href={addressUrl(RECEIPTS_ADDRESS)} className="mono">
                        ArbolitoReceipts {shortHex(RECEIPTS_ADDRESS, 6, 4)} ↗
                      </ExtLink>
                    </dd>
                  </>
                )}
                <dt>{t.wallet}</dt>
                <dd>
                  <ExtLink href={addressUrl(v.taker)} className="mono">
                    {shortHex(v.taker, 6, 4)} ↗
                  </ExtLink>
                </dd>
                <dt>{t.attribution}</dt>
                <dd className="mono">{v.execution.attribution.join(", ") || "—"}</dd>
              </dl>
            </div>

            <VerifyPanel
              lang={lang}
              bundleJson={JSON.stringify(rec.bundle)}
              receiptsAddress={RECEIPTS_ADDRESS ?? null}
              rpcUrl={PUBLIC_RPC_URL}
              downloadHref={`/r/${rec.id}/bundle.json`}
              server={verification}
            />

            <details className="how">
              <summary>
                {t.rawTitle} ({v.quotesConsidered})
              </summary>
              <pre>{JSON.stringify(rec.bundle.quotesConsidered, null, 2)}</pre>
            </details>
          </div>
        </details>
      </section>
    </Shell>
  );
}
