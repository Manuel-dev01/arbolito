import type { Metadata } from "next";
import { txUrl } from "@arbolito/config";
import { AutoRefresh } from "../../components/public/auto-refresh";
import { Display, ExtLink, Shell } from "../../components/public/shell";
import { getLang, LOCALE, messages, withLang } from "../../i18n/messages";
import { loadAgentEconomy } from "../../lib/agent-economy";
import { AGENT_WALLET } from "../../lib/agent-registration";
import { formatFixed, formatMoney, shortHex, type Locale } from "../../lib/format";
import { addressUrl } from "../../lib/receipts-abi";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const revalidate = 60;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const t = messages(getLang((await searchParams).lang)).agent;
  return { title: t.metaTitle, description: t.lead };
}

const BASE = "https://arbolito-livid.vercel.app";
const DECIMALS: Record<string, number> = { wARS: 18, wBRL: 18, wCOP: 18, wMXN: 18, USDT: 6, USDC: 6, USAT: 6 };
const when = (iso: string, locale: Locale) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso));

function Tx({ hash }: { hash: string | null }) {
  return hash ? (
    <ExtLink href={txUrl(hash)} className="mono">
      {shortHex(hash)}
    </ExtLink>
  ) : (
    <span className="muted">—</span>
  );
}

/** What Arbolito, the agent, charges, pays and settles: every row links to its Celo transaction. */
export default async function AgentPage({ searchParams }: Props) {
  const lang = getLang((await searchParams).lang);
  const locale = LOCALE[lang];
  const t = messages(lang).agent;
  const e = await loadAgentEconomy();
  const usd = (micros: bigint) => formatMoney(micros, 6, "USD", locale);
  const autoRuns = e.ruleRuns.length;
  const net = e.salesUsdMicros + e.desk.spreadMicros - e.paidUsdMicros;

  const big = [
    { k: t.big.charged, v: usd(e.salesUsdMicros), s: t.bigSub.calls(e.sales.length), href: "#charges" },
    { k: t.big.paid, v: usd(e.paidUsdMicros), s: t.bigSub.payments(e.payments.length), href: "#pays" },
    { k: t.big.settled, v: usd(e.conversions.usdMicros), s: t.bigSub.settled(e.conversions.count, autoRuns), href: "#settles" },
    {
      k: t.big.score,
      v: e.reputation.score === null ? "—" : String(e.reputation.score),
      s: e.reputation.rank === null ? "" : t.bigSub.rank(e.reputation.rank.toLocaleString(locale), e.reputation.feedbacks ?? 0),
      href: "https://8004scan.io/agents/celo/9976",
    },
  ];

  return (
    <Shell lang={lang} path="/agent" size="l">
      <AutoRefresh seconds={60} />
      <header className="page-head">
        <span className="live-dot kicker">{t.kicker}</span>
        <Display as="h1" a={t.titleA} b={t.titleB} accent="lime" className="display-m" />
        <p className="lead">{t.lead}</p>
        <p className="small muted">
          <ExtLink href={addressUrl(AGENT_WALLET)} className="mono">
            {AGENT_WALLET}
          </ExtLink>{" "}
          · ERC-8004 #9976
        </p>
      </header>

      <section className="big-numbers" aria-label={t.kicker}>
        {big.map((b) => (
          <a key={b.k} className="big" href={b.href}>
            <span className="big-k">{b.k}</span>
            <span className="big-v">{b.v}</span>
            {b.s && <span className="big-s">{b.s}</span>}
          </a>
        ))}
      </section>

      <section className="card" id="charges">
        <div className="card-head">
          <h2 className="h2">{t.charges}</h2>
          <p className="lead">{t.chargesLead}</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.col.when}</th>
                <th>{t.col.what}</th>
                <th>{t.col.who}</th>
                <th className="num">{t.col.amount}</th>
                <th>{t.col.tx}</th>
              </tr>
            </thead>
            <tbody>
              {e.sales.map((s) => (
                <tr key={s.txHash}>
                  <td className="small">{when(s.at, locale)}</td>
                  <td className="mono small">{s.resource}</td>
                  <td>
                    <ExtLink href={addressUrl(s.payer)} className="mono">
                      {shortHex(s.payer)}
                    </ExtLink>
                  </td>
                  <td className="num">
                    {formatFixed(BigInt(s.amount), DECIMALS[s.asset] ?? 18, locale, { dp: DECIMALS[s.asset] === 6 ? 4 : 3 })} {s.asset}
                  </td>
                  <td>
                    <Tx hash={s.txHash} />
                  </td>
                </tr>
              ))}
              {e.sales.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {t.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" id="pays">
        <div className="card-head">
          <h2 className="h2">{t.pays}</h2>
          <p className="lead">{t.paysLead}</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.col.when}</th>
                <th>{t.col.who}</th>
                <th>{t.col.what}</th>
                <th className="num">{t.col.amount}</th>
                <th>{t.col.tx}</th>
                <th>{t.col.feedback}</th>
              </tr>
            </thead>
            <tbody>
              {e.payments.map((p, i) => (
                <tr key={p.txHash ?? i}>
                  <td className="small">{when(p.at, locale)}</td>
                  <td>{p.providerAgentId ? <ExtLink href={`https://8004scan.io/agents/celo/${p.providerAgentId}`}>{`${p.provider} #${p.providerAgentId}`}</ExtLink> : p.provider}</td>
                  <td className="small">{p.what}</td>
                  <td className="num">{usd(BigInt(p.usdMicros))}</td>
                  <td>
                    <Tx hash={p.txHash} />
                  </td>
                  <td>
                    <Tx hash={p.feedbackTx} />
                  </td>
                </tr>
              ))}
              {e.payments.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    {t.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" id="settles">
        <div className="card-head">
          <h2 className="h2">{t.settles}</h2>
          <p className="lead">{t.settlesLead}</p>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.col.when}</th>
                <th>{t.col.what}</th>
                <th>{t.col.who}</th>
                <th>{t.col.status}</th>
                <th>{t.col.tx}</th>
              </tr>
            </thead>
            <tbody>
              {e.ruleRuns.map((r, i) => (
                <tr key={`${r.at}-${i}`}>
                  <td className="small">{when(r.at, locale)}</td>
                  <td>{t.kind[r.kind]}</td>
                  <td>
                    <ExtLink href={addressUrl(r.account)} className="mono">
                      {shortHex(r.account)}
                    </ExtLink>
                  </td>
                  <td className="small">{r.status}</td>
                  <td className="small">
                    {r.txHashes.map((h, j) => (
                      <span key={h}>
                        {j > 0 && " "}
                        <Tx hash={h} />
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
              {e.ruleRuns.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    {t.empty}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="small">
          <a href={withLang("/metrics", lang)}>{t.conversionsLink} →</a> · <a href={withLang("/desk", lang)}>{t.deskLink} →</a>
        </p>
      </section>

      <section className="grid-2">
        <div className="card" id="pnl">
          <div className="card-head">
            <h2 className="h2">{t.pnl}</h2>
            <p className="lead">{t.pnlLead}</p>
          </div>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td>{t.pnlRows.x402}</td>
                  <td className="num">{usd(e.salesUsdMicros)}</td>
                </tr>
                <tr>
                  <td>{t.pnlRows.spread}</td>
                  <td className="num">{usd(e.desk.spreadMicros)}</td>
                </tr>
                <tr>
                  <td>{t.pnlRows.spent}</td>
                  <td className="num">−{usd(e.paidUsdMicros)}</td>
                </tr>
                <tr>
                  <td>
                    <strong>{t.pnlRows.net}</strong>
                  </td>
                  <td className="num">
                    <strong>{usd(net)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="card" id="hire">
          <div className="card-head">
            <h2 className="h2">{t.hire}</h2>
            <p className="lead">{t.hireLead}</p>
          </div>
          <ul className="small" style={{ display: "grid", gap: 8, paddingLeft: 18 }}>
            <li>
              MCP: <span className="mono">{BASE}/api/mcp</span>
            </li>
            <li>
              A2A: <ExtLink href={`${BASE}/.well-known/agent-card.json`} className="mono">{`${BASE}/.well-known/agent-card.json`}</ExtLink>
            </li>
            <li>
              x402: <span className="mono">GET {BASE}/api/x402/quote?from=USDT&amp;to=wARS&amp;amount=100</span> (US$ 0.01)
            </li>
            <li>
              x402: <span className="mono">GET {BASE}/api/x402/rates</span> (US$ 0.005)
            </li>
            <li>
              ERC-8004: <ExtLink href={`${BASE}/.well-known/agent-registration.json`} className="mono">agent-registration.json</ExtLink>
            </li>
          </ul>
        </div>
      </section>
    </Shell>
  );
}
