import type { Metadata } from "next";
import { Display, Shell } from "../../components/public/shell";
import { getLang, messages, withLang } from "../../i18n/messages";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const t = messages(getLang((await searchParams).lang)).desk;
  return { title: t.metaTitle, description: t.lead };
}

function Empty({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <span />
      </span>
      <span>{text}</span>
    </div>
  );
}

/**
 * Arbolito Desk, placeholder. The structure the live page will have (quotes, fills, inventory by
 * currency, P&L, market mood, self-paid costs) with designed empty states. No example numbers:
 * every figure here will come from a real transaction once the desk runs.
 */
export default async function DeskPage({ searchParams }: Props) {
  const lang = getLang((await searchParams).lang);
  const t = messages(lang).desk;
  const s = t.sections;

  return (
    <Shell lang={lang} path="/desk" size="l">
      <header className="page-head">
        <span className="kicker">{t.kicker}</span>
        <Display as="h1" a={t.titleA} b={t.titleB} accent="pink" className="display-m" />
        <p className="lead">{t.lead}</p>
      </header>

      <div className="desk-grid">
        <section className="card desk-card" aria-labelledby="desk-quotes">
          <h2 id="desk-quotes">{s.quotes.t}</h2>
          <p>{s.quotes.d}</p>
          <div className="table-wrap">
            <table className="ghost-table">
              <thead>
                <tr>
                  <th>{t.cols.pair}</th>
                  <th className="num">{t.cols.amount}</th>
                  <th className="num">{t.cols.price}</th>
                  <th className="num">{t.cols.result}</th>
                </tr>
              </thead>
            </table>
          </div>
          <Empty text={s.quotes.empty} />
        </section>

        <section className="card desk-card" aria-labelledby="desk-fills">
          <h2 id="desk-fills">{s.fills.t}</h2>
          <p>{s.fills.d}</p>
          <div className="table-wrap">
            <table className="ghost-table">
              <thead>
                <tr>
                  <th>{t.cols.pair}</th>
                  <th className="num">{t.cols.amount}</th>
                  <th>{t.cols.tx}</th>
                </tr>
              </thead>
            </table>
          </div>
          <Empty text={s.fills.empty} />
        </section>

        <section className="card desk-card" aria-labelledby="desk-inv">
          <h2 id="desk-inv">{s.inventory.t}</h2>
          <p>{s.inventory.d}</p>
          <div>
            {t.currencies.map((c) => (
              <div className="inv-row" key={c.fiat}>
                <span className={`cur-badge cur-${c.fiat}`} aria-hidden="true">
                  {c.fiat === "ARS" ? "$" : c.fiat === "BRL" ? "R$" : "US$"}
                </span>
                <span className="inv-name">
                  {c.name}
                  <span className="mono">{c.fiat}</span>
                </span>
                <span className="inv-val" aria-label={t.empty}>
                  —
                </span>
              </div>
            ))}
          </div>
          <Empty text={s.inventory.empty} />
        </section>

        <section className="card desk-card" aria-labelledby="desk-pnl">
          <h2 id="desk-pnl">{s.pnl.t}</h2>
          <p>{s.pnl.d}</p>
          <Empty text={s.pnl.empty} />
        </section>

        <section className="card desk-card" aria-labelledby="desk-mood">
          <h2 id="desk-mood">{s.mood.t}</h2>
          <p>{s.mood.d}</p>
          <div aria-hidden="true">
            <span className="mood-track" />
            <div className="mood-scale" style={{ marginTop: 8 }}>
              <span>ARS</span>
              <span>USD</span>
            </div>
          </div>
          <Empty text={s.mood.empty} />
        </section>

        <section className="card desk-card" aria-labelledby="desk-costs">
          <h2 id="desk-costs">{s.costs.t}</h2>
          <p>{s.costs.d}</p>
          <Empty text={s.costs.empty} />
        </section>
      </div>

      <p className="small muted">{t.noFake}</p>
      <a className="text-link" href={withLang("/metrics", lang)}>
        {t.toMetrics}
      </a>
    </Shell>
  );
}
