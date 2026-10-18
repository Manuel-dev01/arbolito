import type { Metadata } from "next";
import { TOKENS, txUrl } from "@arbolito/config";
import { Display, ExtLink, Shell } from "../../components/public/shell";
import { getLang, LOCALE, messages, withLang } from "../../i18n/messages";
import { DESK_CAPITAL_MICROS, loadDesk, type FeedCorridor } from "../../lib/desk";
import { formatBps, formatFixed, formatMoney, shortHex, type Locale } from "../../lib/format";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const revalidate = 30;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const t = messages(getLang((await searchParams).lang)).desk;
  return { title: t.metaTitle, description: t.lead };
}

const TZ = "America/Argentina/Buenos_Aires";
const PAIRS: Record<string, { soft: "wARS" | "wBRL" | "USDC" | "USAT"; fiat: "ARS" | "BRL" | "USD" }> = {
  "wars-usdt": { soft: "wARS", fiat: "ARS" },
  "wbrl-usdt": { soft: "wBRL", fiat: "BRL" },
  "usdc-usdt": { soft: "USDC", fiat: "USD" },
  "usat-usdt": { soft: "USAT", fiat: "USD" },
};
/** A stable pair reads as "1 USDC = 1,0013 USDT"; a wFIAT pair as "ARS 1.613,94" per US$. */
const usdtPer = (soft: string, px: number, locale: Locale) => `1 ${soft} = ${formatFixed(BigInt(Math.round(px * 1e4)), 4, locale, { dp: 4 })} USDT`;

/** "1 US$ = ARS 1.613,94" style: fiat per USD with 2 decimals (4 for small rates like BRL). */
const perUsd = (fiat: string, fiatPerUsd: number, locale: Locale) => {
  const dp = fiatPerUsd < 100 ? 4 : 2;
  return `${fiat} ${formatFixed(BigInt(Math.round(fiatPerUsd * 10 ** dp)), dp, locale, { dp })}`;
};
const time = (iso: string, locale: Locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date(iso));

function CorridorStatus({ c, lang }: { c: FeedCorridor; lang: ReturnType<typeof getLang> }) {
  const t = messages(lang).desk;
  const locale = LOCALE[lang];
  const meta = PAIRS[c.pair];
  const d = c.decisions.at(-1);
  if (!meta || !d) return null;
  const live = d.action === "publish" && !!c.served;
  // The served mid already carries the skew; Stitch quotes ± the side spreads around it.
  // Prices in USDT per soft unit; wFIAT pairs are shown per US$ (inverted) below.
  const bidPx = c.served ? c.served.price * (1 - c.params.buyOffsetBps / 10_000) : undefined;
  const askPx = c.served ? c.served.price * (1 + c.params.sellOffsetBps / 10_000) : undefined;
  const show = (px: number) => (meta.fiat === "USD" ? usdtPer(meta.soft, px, locale) : perUsd(meta.fiat, 1 / px, locale));
  return (
    <div className="desk-corridor">
      <div className="desk-corridor-head">
        <b>{meta.soft} / USDT</b>
        <span className={live ? "live-dot mono" : "mono muted"}>{live ? t.live : t.paused}</span>
      </div>
      {!live && d.reason && (
        <p className="small muted">
          {t.status.hold} {d.reason}
        </p>
      )}
      <dl className="desk-kv">
        {d.fiatPerUsd !== undefined && (
          <div>
            <dt>{t.status.fair}</dt>
            <dd className="mono">{meta.fiat === "USD" ? usdtPer(meta.soft, 1 / d.fiatPerUsd, locale) : `1 US$ = ${perUsd(meta.fiat, d.fiatPerUsd, locale)}`}</dd>
          </div>
        )}
        <div>
          <dt>{t.status.skew}</dt>
          <dd className="mono">{formatBps(d.skewBps ?? 0, locale)}</dd>
        </div>
        {bidPx !== undefined && askPx !== undefined && (
          <>
            <div>
              <dt>
                {t.status.bid} {meta.soft}
              </dt>
              <dd className="mono">{show(bidPx)}</dd>
            </div>
            <div>
              <dt>
                {t.status.ask} {meta.soft}
              </dt>
              <dd className="mono">{show(askPx)}</dd>
            </div>
          </>
        )}
        <div>
          <dt>{t.status.sources}</dt>
          <dd className="mono small">{d.used.join(" · ")}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Arbolito Desk, live: what the feed is quoting now (from its /state), the fills it has made on
 * Celo, inventory and P&L against the 40 USDT it was funded with (from apps/desk's ledger).
 */
export default async function DeskPage({ searchParams }: Props) {
  const lang = getLang((await searchParams).lang);
  const t = messages(lang).desk;
  const locale = LOCALE[lang];
  const view = await loadDesk();
  const s = view.latest;
  const nav = s?.navMicros ? BigInt(s.navMicros) : undefined;
  const result = nav !== undefined ? nav - DESK_CAPITAL_MICROS : undefined;
  const usd = (micros: bigint, signed = false) => formatMoney(micros, 6, "USD", locale, { signed });
  const softUsd = (amount: string, decimals: number, fair: number | null) => (fair === null ? undefined : BigInt(Math.round((Number(amount) / 10 ** decimals) * fair * 1e6)));

  return (
    <Shell lang={lang} path="/desk" size="l">
      <header className="page-head">
        <span className="kicker">{t.kicker}</span>
        <Display as="h1" a={t.titleA} b={t.titleB} accent="pink" className="display-m" />
        <p className="lead">{t.lead}</p>
        {view.feed?.lastTickAt && <span className="live-dot mono small">{t.updated(time(view.feed.lastTickAt, locale))}</span>}
      </header>

      <div className="desk-grid">
        <section className="card desk-card" aria-labelledby="desk-status">
          <h2 id="desk-status">{t.status.t}</h2>
          <p>{t.status.d}</p>
          {view.feed ? view.feed.corridors.filter((c) => c.params.live !== false).map((c) => <CorridorStatus key={c.pair} c={c} lang={lang} />) : <p className="small muted">{t.unavailable}</p>}
        </section>

        <section className="card desk-card" aria-labelledby="desk-pnl">
          <h2 id="desk-pnl">{t.pnl.t}</h2>
          <p>{t.pnl.d}</p>
          <dl className="desk-kv">
            <div>
              <dt>{t.pnl.nav}</dt>
              <dd className="mono">{nav !== undefined ? usd(nav) : "—"}</dd>
            </div>
            <div>
              <dt>{t.pnl.capital}</dt>
              <dd className="mono">{usd(DESK_CAPITAL_MICROS)}</dd>
            </div>
            <div>
              <dt>{t.pnl.result}</dt>
              <dd className={`mono ${result !== undefined && result < 0n ? "neg" : "pos"}`}>{result !== undefined ? usd(result, true) : "—"}</dd>
            </div>
            <div>
              <dt>{t.pnl.spread}</dt>
              <dd className="mono">{usd(BigInt(view.stats.spreadMicros), true)}</dd>
            </div>
            <div>
              <dt>{t.pnl.volume}</dt>
              <dd className="mono">{usd(BigInt(view.stats.volumeMicros))}</dd>
            </div>
            <div>
              <dt>{t.pnl.count}</dt>
              <dd className="mono">{view.stats.fills}</dd>
            </div>
          </dl>
          <p className="small muted">{t.pnl.note}</p>
        </section>

        <section className="card desk-card desk-wide" aria-labelledby="desk-fills">
          <h2 id="desk-fills">{t.fills.t}</h2>
          <p>{t.fills.d}</p>
          {view.fills.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t.cols.time}</th>
                    <th>{t.cols.pair}</th>
                    <th>{t.cols.side}</th>
                    <th className="num">{t.cols.amount}</th>
                    <th className="num">{t.cols.price}</th>
                    <th className="num">{t.cols.vsFair}</th>
                    <th>{t.cols.tx}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.fills.map((f) => {
                    const meta = PAIRS[f.pair];
                    const dec = meta ? TOKENS[meta.soft].decimals : 18;
                    // (USDC and USA₮ have 6 decimals; wFIAT 18.)
                    return (
                      <tr key={f.txHash}>
                        <td className="nowrap">{time(f.at, locale)}</td>
                        <td className="nowrap">{meta ? `${meta.soft}/USDT` : f.pair}</td>
                        <td>{f.side === "buy" ? t.side.buy : t.side.sell}</td>
                        <td className="num nowrap">
                          {formatFixed(BigInt(f.softAmount), dec, locale, { dp: 2, minDp: 0 })} {meta?.soft} · {usd(BigInt(f.usdtAmount))}
                        </td>
                        <td className="num nowrap mono">{!meta ? f.price : meta.fiat === "USD" ? usdtPer(meta.soft, f.price, locale) : perUsd(meta.fiat, 1 / f.price, locale)}</td>
                        <td className={`num nowrap mono ${f.edgeBps !== null && f.edgeBps < 0 ? "neg" : "pos"}`}>{f.edgeBps === null ? "—" : formatBps(f.edgeBps, locale)}</td>
                        <td>
                          <ExtLink href={txUrl(f.txHash)} className="mono">
                            {shortHex(f.txHash)} ↗
                          </ExtLink>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted">{t.fills.empty}</p>
          )}
        </section>

        <section className="card desk-card" aria-labelledby="desk-inv">
          <h2 id="desk-inv">{t.inventory.t}</h2>
          <p>{t.inventory.d}</p>
          {s ? (
            <div>
              {(
                [
                  ["USD", "USDT", formatFixed(BigInt(s.usdt), 6, locale, { dp: 2 }), BigInt(s.usdt)],
                  ["ARS", "wARS", formatFixed(BigInt(s.wars), 18, locale, { dp: 2 }), softUsd(s.wars, 18, s.fairs["wars-usdt"] ?? s.fairWars)],
                  ["BRL", "wBRL", formatFixed(BigInt(s.wbrl), 18, locale, { dp: 2 }), softUsd(s.wbrl, 18, s.fairs["wbrl-usdt"] ?? s.fairWbrl)],
                  ...(s.usdc !== null ? ([["USD", "USDC", formatFixed(BigInt(s.usdc), 6, locale, { dp: 2 }), softUsd(s.usdc, 6, s.fairs["usdc-usdt"] ?? null)]] as const) : []),
                  ...(s.usat !== null ? ([["USD", "USA₮", formatFixed(BigInt(s.usat), 6, locale, { dp: 2 }), softUsd(s.usat, 6, s.fairs["usat-usdt"] ?? null)]] as const) : []),
                ] as const
              ).map(([fiat, sym, amount, inUsd]) => (
                <div className="inv-row" key={sym}>
                  <span className={`cur-badge cur-${fiat}`} aria-hidden="true">
                    {fiat === "ARS" ? "$" : fiat === "BRL" ? "R$" : "US$"}
                  </span>
                  <span className="inv-name">
                    {sym}
                    <span className="mono">{amount}</span>
                  </span>
                  <span className="inv-val mono">{inUsd !== undefined ? `≈ ${usd(inUsd)}` : "—"}</span>
                </div>
              ))}
              {nav !== undefined && (
                <div className="inv-row">
                  <span />
                  <span className="inv-name">
                    <b>{t.inventory.total}</b>
                  </span>
                  <span className="inv-val mono">
                    <b>{usd(nav)}</b>
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="small muted">{t.inventory.empty}</p>
          )}
        </section>

        <section className="card desk-card" aria-labelledby="desk-strategy">
          <h2 id="desk-strategy">{t.strategy.t}</h2>
          <ul className="desk-list">
            {t.strategy.items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>
      </div>

      <p className="small muted">{t.noFake}</p>
      <a className="text-link" href={withLang("/metrics", lang)}>
        {t.toMetrics}
      </a>
    </Shell>
  );
}
