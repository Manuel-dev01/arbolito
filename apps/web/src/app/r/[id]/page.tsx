import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bundleHash } from "@arbolito/proof";
import { ExtLink, Shell } from "../../../components/chrome";
import { VerifyPanel } from "../../../components/verify-panel";
import { getLang, LOCALE, messages, withLang, type Lang, type Messages } from "../../../i18n/messages";
import { anchorFor, getReceiptCached, verifyReceipt } from "../../../lib/cached";
import { PUBLIC_RPC_URL, RECEIPTS_ADDRESS } from "../../../lib/chain";
import { formatBps, formatFixed, formatMoney, formatRate, formatToken, RATE_ONE, shortHex, type Locale } from "../../../lib/format";
import { buildReceiptView, type RouteView, type StepView, type TokenRef } from "../../../lib/receipt-view";
import { addressUrl, blockUrl, txUrl } from "../../../lib/receipts-abi";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const rec = await getReceiptCached(id);
  if (!rec) return { title: "Comprobante" };
  const v = buildReceiptView(rec.bundle);
  const l: Locale = "es-AR";
  const title = `${formatMoney(v.amountIn, v.tokenIn.decimals, v.tokenIn.fiat, l)} → ${formatMoney(v.amountOut, v.tokenOut.decimals, v.tokenOut.fiat, l)}`;
  return { title, description: messages("es").verify.lead, robots: rec.supersededBy ? { index: false } : undefined };
}

const money = (amount: bigint, t: TokenRef, locale: Locale, signed = false) => formatMoney(amount, t.decimals, t.fiat, locale, { signed });

/** "1 BRL = 317,74 ARS", flipped when the rate is below 1 so it stays readable (1 USD = 1.540 ARS, not 1 ARS = 0,00065 USD). */
function rateText(rate: bigint, from: TokenRef, to: TokenRef, locale: Locale, t: Messages["receipt"]): string {
  if (rate === 0n) return "—";
  if (rate >= RATE_ONE || from.fiat === to.fiat) return t.rateLine(from.fiat, formatRate(rate, locale), to.fiat);
  return t.rateLine(to.fiat, formatRate((RATE_ONE * RATE_ONE) / rate, locale), from.fiat);
}

function poolFee(fee: number, locale: Locale): string {
  const pct = formatFixed(BigInt(fee), 4, locale, { dp: 4, minDp: 2 });
  return locale === "en-US" ? `${pct}%` : `${pct} %`;
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
            {venueNote(s) && <span className="faint">{venueNote(s)}</span>}
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

export default async function ReceiptPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const lang = getLang(sp.lang);
  const locale = LOCALE[lang];
  const t = messages(lang).receipt;
  const rec = await getReceiptCached(id);
  if (!rec) notFound();

  const v = buildReceiptView(rec.bundle);
  const hash = bundleHash(rec.bundle);
  const [verification, anchorLookup] = await Promise.all([verifyReceipt(hash, rec.bundle), anchorFor(rec, hash)]);
  const anchor = verification.result?.anchor ?? anchorLookup;

  const status = rec.supersededBy
    ? { cls: "warn", label: t.status.superseded }
    : verification.result?.ok
      ? { cls: "good", label: t.status.verified }
      : verification.result
        ? { cls: "bad", label: t.status.failed }
        : { cls: "warn", label: t.status.unavailable };

  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "long", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(v.createdAt));
  const officialFiat = v.savings?.pair.split("/")[1] ?? v.tokenOut.fiat;
  const path = `/r/${rec.id}`;

  return (
    <Shell lang={lang} path={path}>
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

      <section className="card" aria-labelledby="receipt-title">
        <div className="hero-top">
          <div className="eyebrow" id="receipt-title">
            {t.title} · {date}
          </div>
          <a href="#verify" className={`badge ${status.cls}`}>
            {status.label}
          </a>
        </div>
        <div className="amounts">
          <div className="amount">
            <span className="label">{t.sent}</span>
            <span className="big">{money(v.amountIn, v.tokenIn, locale)}</span>
            <span className="sub">{formatToken(v.amountIn, v.tokenIn.decimals, v.tokenIn.symbol, locale)}</span>
          </div>
          <div className="arrow" aria-hidden="true">
            →
          </div>
          <div className="amount">
            <span className="label">{t.received}</span>
            <span className="big">{money(v.amountOut, v.tokenOut, locale)}</span>
            <span className="sub">{formatToken(v.amountOut, v.tokenOut.decimals, v.tokenOut.symbol, locale)}</span>
          </div>
        </div>
        <div className="rate">
          <span className="muted">{t.rateTitle}</span>
          <strong>{rateText(v.rate, v.tokenIn, v.tokenOut, locale, t)}</strong>
        </div>
        {v.savings ? (
          <p className={`savings ${v.savings.delta >= 0n ? "good" : "bad"}`}>
            {(v.savings.delta >= 0n ? t.savingsMore : t.savingsLess)(
              formatMoney(v.savings.delta < 0n ? -v.savings.delta : v.savings.delta, v.tokenOut.decimals, officialFiat, locale),
              formatBps(v.savings.bps, locale),
              v.savings.pair,
            )}
          </p>
        ) : (
          <p className="small muted" style={{ marginTop: 10 }}>
            {t.noOfficial}
          </p>
        )}
      </section>

      {v.comparisons.length > 0 && (
        <section className="card" aria-labelledby="cmp-title">
          <h2 id="cmp-title">{t.compareTitle}</h2>
          <p className="lead small">{t.compareLead}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.col.reference}</th>
                  <th className="num">
                    {t.col.rate} ({v.comparisons[0]!.pair})
                  </th>
                  <th className="num">{t.col.wouldGet}</th>
                  <th className="num">{t.col.diff}</th>
                </tr>
              </thead>
              <tbody>
                {v.comparisons.map((c) => (
                  <tr key={c.name}>
                    <td>
                      {t.refName[c.name]}
                      <div className="small faint">
                        {c.via ? `${t.via(c.via.pair, t.refShort[c.via.name])} · ` : ""}
                        {c.source.startsWith("http") ? (
                          <ExtLink href={c.source}>{t.source}</ExtLink>
                        ) : (
                          <span className="mono" title={c.source}>
                            {shortHex(c.source, 18, 9)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="num">{formatRate(c.rate, locale)}</td>
                    <td className="num">{money(c.referenceOut, v.tokenOut, locale)}</td>
                    <td className={`num ${c.delta >= 0n ? "pos" : "neg"}`}>
                      {money(c.delta, v.tokenOut, locale, true)}
                      <div className="small">{formatBps(c.bps, locale)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="route-title">
        <h2 id="route-title">{t.routeTitle}</h2>
        <p className="lead small">{t.routeLead(v.quotesConsidered)}</p>
        <span className="chosen-tag">✓ {v.chosen.label}</span>
        <Route route={v.chosen} lang={lang} chosen />
        <p className="small muted">
          {t.minOut}: {money(v.chosen.minOut, v.tokenOut, locale)}
        </p>

        <h3 style={{ marginTop: 18 }}>{t.altTitle}</h3>
        {v.alternatives.length === 0 && <p className="small muted">{t.altNone}</p>}
        {v.alternatives.map((a) => (
          <div className="alt" key={a.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="small mono faint">{a.label}</span>
              <span className={`small ${a.diffVsChosen >= 0n ? "pos" : "neg"}`}>
                {money(a.diffVsChosen, v.tokenOut, locale, true)} ({formatBps(a.diffBps, locale)})
              </span>
            </div>
            <Route route={a} lang={lang} />
            {a.diffVsChosen > 0n && a.steps.some((s) => s.venue !== "uniswap_v3" && !s.firm) && <p className="small muted">{t.altBetterNote}</p>}
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="tx-title">
        <h2 id="tx-title">{t.txTitle}</h2>
        <dl className="kv">
          <dt>{t.execTx}</dt>
          <dd>
            <ExtLink href={txUrl(v.execution.txHash)} className="mono">
              {shortHex(v.execution.txHash, 10, 8)} ↗
            </ExtLink>{" "}
            <span className="small faint">
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
                  <span className="small faint">
                    {t.block} <ExtLink href={blockUrl(anchor.blockNumber)}>{anchor.blockNumber}</ExtLink>
                  </span>
                )}
              </>
            ) : (
              <span className="faint">{t.unknown}</span>
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
      </section>

      <VerifyPanel
        lang={lang}
        bundleJson={JSON.stringify(rec.bundle)}
        receiptsAddress={RECEIPTS_ADDRESS ?? null}
        rpcUrl={PUBLIC_RPC_URL}
        downloadHref={`/r/${rec.id}/bundle.json`}
        server={verification}
      />

      <details className="card">
        <summary>
          {t.rawTitle} ({v.quotesConsidered})
        </summary>
        <pre>{JSON.stringify(rec.bundle.quotesConsidered, null, 2)}</pre>
      </details>
    </Shell>
  );
}
