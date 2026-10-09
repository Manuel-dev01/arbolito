import type { Metadata } from "next";
import { bundleHash } from "@arbolito/proof";
import { AutoRefresh } from "../../components/auto-refresh";
import { ExtLink, Shell } from "../../components/chrome";
import { getLang, LOCALE, messages, withLang } from "../../i18n/messages";
import { anchorFor, listReceiptsCached } from "../../lib/cached";
import { formatBps, formatFixed, formatMoney, formatToken, shortHex } from "../../lib/format";
import { RECEIPTS_ADDRESS } from "../../lib/chain";
import { computeMetrics } from "../../lib/metrics";
import { addressUrl, txUrl } from "../../lib/receipts-abi";

export const metadata: Metadata = { title: "Métricas", description: messages("es").metrics.lead };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

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

  return (
    <Shell lang={lang} path="/metrics">
      <AutoRefresh seconds={60} />
      <section>
        <h1>{t.title}</h1>
        <p className="lead">{t.lead}</p>
        <p className="small faint">
          {t.updated(`${updated} UTC`)} · {fromDb ? t.sourceDb : t.sourceFile}
        </p>
      </section>

      <section className="tiles" aria-label={t.title}>
        <a className="tile" href="#wallets">
          <span className="k">{t.wallets}</span>
          <span className="v">{m.wallets.length}</span>
        </a>
        <a className="tile" href="#receipts">
          <span className="k">{t.txs}</span>
          <span className="v">{m.executionTxs.length}</span>
          <span className="s">{t.anchors(m.anchorTxs.length)}</span>
        </a>
        <a className="tile" href="#receipts">
          <span className="k">{t.receipts}</span>
          <span className="v">{m.receipts.length}</span>
        </a>
        <a className="tile" href="#by-token">
          <span className="k">{t.volume}</span>
          <span className="v">{usd(m.totalUsdMicros)}</span>
          <span className="s">{t.volumeSub}</span>
        </a>
        <a className="tile" href="#receipts">
          <span className="k">{t.medianSavings}</span>
          <span className="v">{m.savingsArs.medianBps === undefined ? "—" : formatBps(m.savingsArs.medianBps, locale)}</span>
          <span className="s">
            {m.savingsArs.medianBps === undefined
              ? t.noSavings
              : t.medianSub(formatMoney(m.savingsArs.totalDelta, m.savingsArs.decimals, "ARS", locale), m.savingsArs.receiptIds.length)}
          </span>
        </a>
      </section>

      <section className="grid-2">
        <div className="card" id="by-token">
          <h2>{t.byToken}</h2>
          <p className="lead small">{t.byTokenLead}</p>
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
                    <td className="small">
                      {v.receiptIds.map((id, i) => (
                        <span key={id}>
                          {i > 0 && ", "}
                          <a href={rHref(id)}>{id.slice(0, 8)}</a>
                        </span>
                      ))}
                    </td>
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
          <h2>{t.corridors}</h2>
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
                    <td className="small">
                      {c.receiptIds.map((id, i) => (
                        <span key={id}>
                          {i > 0 && ", "}
                          <a href={rHref(id)}>{id.slice(0, 8)}</a>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card" id="receipts">
        <h2>{t.receiptsTitle}</h2>
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
                    <div className="small faint">
                      {formatToken(r.amountIn, r.tokenIn.decimals, r.tokenIn.symbol, locale)} → {formatToken(r.amountOut, r.tokenOut.decimals, r.tokenOut.symbol, locale)}
                    </div>
                  </td>
                  <td className="num">{r.usdMicros === undefined ? "—" : usd(r.usdMicros)}</td>
                  <td className={`num ${r.savings ? (r.savings.bps >= 0 ? "pos" : "neg") : ""}`}>
                    {r.savings ? (
                      <>
                        {formatBps(r.savings.bps, locale)}
                        <div className="small faint">{r.savings.pair}</div>
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
          <div style={{ marginTop: 14 }}>
            <h3 className="small muted">{t.supersededTitle}</h3>
            <ul className="small">
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
        <h2>{t.walletsTitle}</h2>
        <ul className="small">
          {m.wallets.map((w) => (
            <li key={w.address}>
              <ExtLink href={addressUrl(w.address)} className="mono">
                {shortHex(w.address, 6, 4)} ↗
              </ExtLink>{" "}
              <span className="faint">
                ·{" "}
                {w.receiptIds.map((id, i) => (
                  <span key={id}>
                    {i > 0 && ", "}
                    <a href={rHref(id)}>{id.slice(0, 8)}</a>
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="soon-title">
        <h2 id="soon-title">{t.comingSoon}</h2>
        <div className="soon">
          {t.soon.map((s) => (
            <div className="card" key={s.title}>
              <h3>{s.title}</h3>
              <p className="small muted">{s.body}</p>
              <span className="badge warn">{t.comingSoon}</span>
            </div>
          ))}
        </div>
      </section>
      {RECEIPTS_ADDRESS && (
        <p className="small faint">
          {tr.contract}:{" "}
          <ExtLink href={addressUrl(RECEIPTS_ADDRESS)} className="mono">
            ArbolitoReceipts {shortHex(RECEIPTS_ADDRESS, 6, 4)} ↗
          </ExtLink>
        </p>
      )}
    </Shell>
  );
}
