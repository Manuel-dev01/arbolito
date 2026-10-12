import type { Metadata } from "next";
import { bundleHash } from "@arbolito/proof";
import { AutoRefresh } from "../../components/public/auto-refresh";
import { Display, ExtLink, Kicker, Shell } from "../../components/public/shell";
import { getLang, LOCALE, messages, withLang } from "../../i18n/messages";
import { anchorFor, listReceiptsCached } from "../../lib/cached";
import { formatBps, formatFixed, formatMoney, formatToken, shortHex } from "../../lib/format";
import { RECEIPTS_ADDRESS } from "../../lib/chain";
import { computeMetrics } from "../../lib/metrics";
import { addressUrl, txUrl } from "../../lib/receipts-abi";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const t = messages(getLang((await searchParams).lang)).metrics;
  return { title: t.title, description: t.lead };
}

/** Calm, editorial metrics: every number links to its source; refreshes itself every 60 s. */
export default async function MetricsPage({ searchParams }: Props) {
  const lang = getLang((await searchParams).lang);
  const locale = LOCALE[lang];
  const t = messages(lang).metrics;
  const tr = messages(lang).receipt;

  const { records, fetchedAt } = await listReceiptsCached();
  const active = records.filter((r) => !r.supersededBy);
  const anchors = new Map(
    await Promise.all(
      active.map(async (r) => {
        const a = await anchorFor(r, bundleHash(r.bundle));
        return [r.id, a?.txHash ?? null] as const;
      }),
    ),
  );
  const m = computeMetrics(records, anchors);
  const usd = (micros: bigint) => formatMoney(micros, 6, "USD", locale);
  const fromDb = records.some((r) => r.source === "db");
  const updated = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(fetchedAt));
  const rHref = (id: string) => withLang(`/r/${id}`, lang);
  const ids = (list: string[]) =>
    list.map((id, i) => (
      <span key={id}>
        {i > 0 && ", "}
        <a href={rHref(id)} className="mono">
          {id.slice(0, 8)}
        </a>
      </span>
    ));

  const big = [
    { k: t.wallets, v: String(m.wallets.length), s: "", proof: t.proof.wallets, href: "#wallets" },
    { k: t.txs, v: String(m.executionTxs.length), s: t.anchors(m.anchorTxs.length), proof: t.proof.txs, href: "#receipts" },
    { k: t.receipts, v: String(m.receipts.length), s: "", proof: t.proof.receipts, href: "#receipts" },
    { k: t.volume, v: usd(m.totalUsdMicros), s: t.volumeSub, proof: t.proof.volume, href: "#by-token" },
    {
      k: t.medianSavings,
      v: m.savingsArs.medianBps === undefined ? "—" : formatBps(m.savingsArs.medianBps, locale),
      s:
        m.savingsArs.medianBps === undefined
          ? t.noSavings
          : t.medianSub(formatMoney(m.savingsArs.totalDelta, m.savingsArs.decimals, "ARS", locale), m.savingsArs.receiptIds.length),
      proof: t.proof.median,
      href: m.savingsArs.receiptIds.length === 1 ? rHref(m.savingsArs.receiptIds[0]!) : "#receipts",
    },
  ];

  return (
    <Shell lang={lang} path="/metrics" size="l">
      <AutoRefresh seconds={60} />
      <header className="page-head">
        <span className="live-dot kicker">{t.kicker}</span>
        <Display as="h1" a={t.titleA} b={t.titleB} accent="pink" className="display-m" />
        <p className="lead">{t.lead}</p>
        <p className="small muted">
          {t.updated(`${updated} UTC`)} · {fromDb ? t.sourceDb : t.sourceFile}
        </p>
      </header>

      <section className="big-numbers" aria-label={t.title}>
        {big.map((b) => (
          <a key={b.k} className="big" href={b.href}>
            <span className="big-k">{b.k}</span>
            <span className="big-v">{b.v}</span>
            {b.s && <span className="big-s">{b.s}</span>}
            <span className="big-proof">{b.proof} →</span>
          </a>
        ))}
      </section>

      <section className="grid-2">
        <div className="card" id="by-token">
          <div className="card-head">
            <h2 className="h2">{t.byToken}</h2>
            <p className="lead">{t.byTokenLead}</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.col.token}</th>
                  <th className="num">{t.col.amount}</th>
                  <th className="num">{t.col.usd}</th>
                  <th>{t.col.sources}</th>
                </tr>
              </thead>
              <tbody>
                {m.volumeByToken.map((v) => (
                  <tr key={v.token.symbol}>
                    <td>
                      <ExtLink href={addressUrl(v.token.address)}>{v.token.symbol}</ExtLink>
                    </td>
                    <td className="num">{formatFixed(v.amount, v.token.decimals, locale, { dp: 2 })}</td>
                    <td className="num">{usd(v.usdMicros)}</td>
                    <td className="small">{ids(v.receiptIds)}</td>
                  </tr>
                ))}
                {m.volumeByToken.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {t.empty}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" id="corridors">
          <div className="card-head">
            <h2 className="h2">{t.corridors}</h2>
            <p className="lead">{t.corridorsLead}</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t.col.corridor}</th>
                  <th className="num">{t.col.count}</th>
                  <th className="num">{t.col.usd}</th>
                  <th>{t.col.sources}</th>
                </tr>
              </thead>
              <tbody>
                {m.corridors.map((c) => (
                  <tr key={`${c.from}>${c.to}`}>
                    <td>
                      {c.from} → {c.to}
                    </td>
                    <td className="num">{c.count}</td>
                    <td className="num">{usd(c.usdMicros)}</td>
                    <td className="small">{ids(c.receiptIds)}</td>
                  </tr>
                ))}
                {m.corridors.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {t.empty}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card" id="receipts">
        <div className="card-head">
          <h2 className="h2">{t.receiptsTitle}</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.col.date}</th>
                <th>{t.col.conversion}</th>
                <th className="num">{t.col.usd}</th>
                <th className="num">{t.col.savings}</th>
                <th>{t.col.sources}</th>
              </tr>
            </thead>
            <tbody>
              {m.receipts.map((r) => (
                <tr key={r.id}>
                  <td className="small">{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(r.createdAt))}</td>
                  <td>
                    <a href={rHref(r.id)}>
                      {formatMoney(r.amountIn, r.tokenIn.decimals, r.tokenIn.fiat, locale)} → {formatMoney(r.amountOut, r.tokenOut.decimals, r.tokenOut.fiat, locale)}
                    </a>
                    <div className="small muted mono">
                      {formatToken(r.amountIn, r.tokenIn.decimals, r.tokenIn.symbol, locale)} → {formatToken(r.amountOut, r.tokenOut.decimals, r.tokenOut.symbol, locale)}
                    </div>
                  </td>
                  <td className="num">{r.usdMicros === undefined ? "—" : usd(r.usdMicros)}</td>
                  <td className={`num ${r.savings ? (r.savings.bps >= 0 ? "pos" : "neg") : ""}`}>
                    {r.savings ? (
                      <>
                        {formatBps(r.savings.bps, locale)}
                        <div className="small muted">{r.savings.pair}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="small">
                    <a href={rHref(r.id)}>{t.receiptLink}</a> · <ExtLink href={txUrl(r.executionTx)}>{t.txLink} ↗</ExtLink>
                    {r.anchorTx && (
                      <>
                        {" "}
                        · <ExtLink href={txUrl(r.anchorTx)}>{t.anchorLink} ↗</ExtLink>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {m.receipts.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {t.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {m.superseded.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <h3 className="small muted" style={{ fontWeight: 700 }}>
              {t.supersededTitle}
            </h3>
            <ul className="list-plain">
              {m.superseded.map((s) => (
                <li key={s.id}>
                  <a href={rHref(s.id)} className="mono">
                    {s.id}
                  </a>{" "}
                  {s.supersededBy && (
                    <>
                      {t.replacedBy}{" "}
                      <a href={rHref(s.supersededBy)} className="mono">
                        {s.supersededBy.slice(0, 8)}
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="card" id="wallets">
        <div className="card-head">
          <h2 className="h2">{t.walletsTitle}</h2>
          <p className="lead">{t.walletsLead}</p>
        </div>
        <ul className="list-plain">
          {m.wallets.map((w) => (
            <li key={w.address}>
              <ExtLink href={addressUrl(w.address)} className="mono">
                {shortHex(w.address, 6, 4)} ↗
              </ExtLink>{" "}
              <span className="muted">· {ids(w.receiptIds)}</span>
            </li>
          ))}
          {m.wallets.length === 0 && <li className="muted">{t.empty}</li>}
        </ul>
      </section>

      <section id="soon" aria-label={t.comingSoon} className="stack-16">
        <div className="card-head">
          <Kicker>{t.comingSoon}</Kicker>
          <p className="lead">{t.soonLead}</p>
        </div>
        <div className="soon-grid">
          {t.soon.map((s) =>
            s.key === "desk" ? (
              <a className="card soon-card" key={s.key} href={withLang("/desk", lang)} style={{ textDecoration: "none" }}>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <span className="soon-tag">
                  {t.comingSoon} · {t.soonLink}
                </span>
              </a>
            ) : (
              <div className="card soon-card" key={s.key}>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <span className="soon-tag">{t.comingSoon}</span>
              </div>
            ),
          )}
        </div>
      </section>
      {RECEIPTS_ADDRESS && (
        <p className="small muted">
          {tr.contract}:{" "}
          <ExtLink href={addressUrl(RECEIPTS_ADDRESS)} className="mono">
            ArbolitoReceipts {shortHex(RECEIPTS_ADDRESS, 6, 4)} ↗
          </ExtLink>
        </p>
      )}
    </Shell>
  );
}
