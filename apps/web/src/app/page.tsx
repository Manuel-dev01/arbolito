import { Shell, TELEGRAM_URL } from "../components/chrome";
import { getLang, messages, withLang } from "../i18n/messages";
import { listReceiptsCached } from "../lib/cached";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const lang = getLang((await searchParams).lang);
  const t = messages(lang).landing;
  const { records } = await listReceiptsCached();
  const latest = records.find((r) => !r.supersededBy);

  return (
    <Shell lang={lang} path="/">
      <section className="hero-landing">
        <div className="kicker">{t.kicker}</div>
        <h1>{t.title}</h1>
        <p className="lead">{t.lead}</p>
        <div className="row">
          <a className="btn primary lg" href={TELEGRAM_URL} rel="noopener">
            {t.cta}
          </a>
          <a className="btn" href={withLang("/metrics", lang)}>
            {t.secondary}
          </a>
          {latest && (
            <a className="btn" href={withLang(`/r/${latest.id}`, lang)}>
              {t.latest}
            </a>
          )}
        </div>
      </section>

      <section className="card chat" aria-label="Telegram">
        <div className="bubble me">
          <b>{t.chatYou}</b>
          {t.chatAsk}
        </div>
        <div className="bubble bot">
          <b>{t.chatBot}</b>
          {t.chatReply}
        </div>
      </section>

      <section className="points">
        {t.points.map((p) => (
          <div className="card" key={p.title}>
            <h2>{p.title}</h2>
            <p className="muted">{p.body}</p>
          </div>
        ))}
      </section>
    </Shell>
  );
}
