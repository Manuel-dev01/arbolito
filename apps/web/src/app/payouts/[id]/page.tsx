import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bundleHash } from "@arbolito/proof";
import { Display, ExtLink, Kicker, Shell } from "../../../components/public/shell";
import { PayeeName, PrintButton } from "../../../components/public/statement-client";
import { getLang, LOCALE, messages, withLang } from "../../../i18n/messages";
import { anchorFor, getReceiptCached, verifyReceipt } from "../../../lib/cached";
import { formatMoney, formatRate, RATE_ONE, fiatPrefix, shortHex } from "../../../lib/format";
import { parseStatementId } from "../../../lib/payout-link";
import { buildStatement } from "../../../lib/payouts";
import { addressUrl, txUrl } from "../../../lib/receipts-abi";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const t = messages(getLang((await searchParams).lang)).payouts;
  return { title: t.title, description: t.lead, robots: { index: false } };
}

/** A payer's statement: several payments, each from its own anchored receipt (lib/payouts.ts). */
export default async function PayoutStatementPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const lang = getLang(sp.lang);
  const locale = LOCALE[lang];
  const t = messages(lang).payouts;
  const ids = parseStatementId(decodeURIComponent(id));
  if (!ids) notFound();
  const found = await Promise.all(ids.map((r) => getReceiptCached(r)));
  const records = found.filter((r): r is NonNullable<typeof r> => r !== null);
  // A statement that silently dropped a payment would be wrong: all of them, or none.
  const s = records.length === ids.length ? buildStatement(records) : null;
  if (!s) notFound();
  const proofs = await Promise.all(
    records.map(async (r) => {
      const hash = bundleHash(r.bundle);
      const [v, a] = await Promise.all([verifyReceipt(hash, r.bundle), anchorFor(r, hash)]);
      return { state: v.result?.ok ? ("verified" as const) : v.result && !v.result.ok && r.anchorTx ? ("mismatch" as const) : ("pending" as const), anchor: a?.txHash ?? null };
    }),
  );
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));
  const stamp = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso));
  const money = (amount: bigint, k: { decimals: number; fiat: string }) => formatMoney(amount, k.decimals, k.fiat, locale);
  const rate = (v: (typeof s.rows)[number]["view"]) =>
    v.rate >= RATE_ONE || v.rate === 0n
      ? `${fiatPrefix(v.tokenIn.fiat)} 1 = ${formatRate(v.rate, locale)} ${v.tokenOut.fiat}`
      : `${fiatPrefix(v.tokenOut.fiat)} 1 = ${formatRate((RATE_ONE * RATE_ONE) / v.rate, locale)} ${v.tokenIn.fiat}`;

  return (
    <Shell lang={lang} path={`/payouts/${id}`} size="l">
      <header className="page-head">
        <Kicker>{t.kicker}</Kicker>
        <Display as="h1" a={t.titleA} b={t.titleB} accent="pink" className="display-m" />
        <p className="lead">{t.lead}</p>
        <p className="small muted">
          {s.from.slice(0, 10) === s.to.slice(0, 10) ? day(s.from) : `${day(s.from)} – ${day(s.to)}`} · {t.payer} <ExtLink href={addressUrl(s.payer)}>{shortHex(s.payer)}</ExtLink>
        </p>
        <PrintButton label={t.print} />
      </header>

      <section className="big-numbers" aria-label={t.title}>
        <div className="big">
          <span className="big-k">{t.payments}</span>
          <span className="big-v">{s.rows.length}</span>
        </div>
        {s.paid.map((p) => (
          <div className="big" key={p.token.address}>
            <span className="big-k">{t.paid}</span>
            <span className="big-v">{money(p.amount, p.token)}</span>
          </div>
        ))}
        {s.received.map((r) => (
          <div className="big" key={r.token.address}>
            <span className="big-k">{t.received}</span>
            <span className="big-v">{money(r.amount, r.token)}</span>
            <span className="big-s">{t.payees(r.payees)}</span>
          </div>
        ))}
      </section>

      <section className="card stack-16">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.col.payee}</th>
                <th className="num">{t.col.paid}</th>
                <th className="num">{t.col.received}</th>
                <th>{t.col.rate}</th>
                <th>{t.col.date}</th>
                <th>{t.col.receipt}</th>
                <th>{t.col.tx}</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <PayeeName index={i} fallback={shortHex(r.recipient)} />
                  </td>
                  <td className="num">{money(r.view.amountIn, r.view.tokenIn)}</td>
                  <td className="num">
                    <b>{money(r.view.amountOut, r.view.tokenOut)}</b>
                  </td>
                  <td className="mono small">{rate(r.view)}</td>
                  <td className="small">{stamp(r.view.createdAt)}</td>
                  <td>
                    <a href={withLang(`/r/${r.id}`, lang)}>{t.state[proofs[i]!.state]}</a>
                  </td>
                  <td className="mono small">
                    <ExtLink href={txUrl(r.view.execution.txHash)}>{shortHex(r.view.execution.txHash)}</ExtLink>
                    {r.deliveryTx && (
                      <>
                        {" + "}
                        <ExtLink href={txUrl(r.deliveryTx)}>{shortHex(r.deliveryTx)}</ExtLink>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{t.foot}</p>
      </section>
    </Shell>
  );
}
