import { Suspense } from "react";
import { Coin } from "../components/public/coin";
import { CalcBody, CalcSection, CalcSkeleton, Faq, Hero, LiveLine, Numbers, pickShowcase, ProofBody, ProofSkeleton, ReceiptSection, Steps, TickerBand, Ticker, Trust } from "../components/public/landing";
import { Shell } from "../components/public/shell";
import { getLang, messages } from "../i18n/messages";
import { listReceiptsCached } from "../lib/cached";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Landing, per design/Arbolito Landing.dc.html: hero, cómo, calc, recibo, números, confianza,
 * faq, pie. Server components throughout; the slow parts (live rates, the onchain anchor) stream
 * in behind Suspense so the hero paints first. Client JS: the calculator and the proof button.
 */
export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const lang = getLang((await searchParams).lang);
  const t = messages(lang).landing;
  const { records } = await listReceiptsCached();
  const showcase = pickShowcase(records);

  return (
    <Shell lang={lang} path="/" size="full">
      <Coin />
      <Hero
        lang={lang}
        showcase={showcase}
        live={
          <Suspense fallback={null}>
            <LiveLine lang={lang} />
          </Suspense>
        }
        ticker={
          <Suspense fallback={<TickerBand items={[t.hero.tickerWaiting, t.hero.tickerProof]} />}>
            <Ticker lang={lang} />
          </Suspense>
        }
      />
      <Steps lang={lang} showcase={showcase} />
      <CalcSection lang={lang}>
        <Suspense fallback={<CalcSkeleton lang={lang} />}>
          <CalcBody lang={lang} fallback={showcase} />
        </Suspense>
      </CalcSection>
      <ReceiptSection
        lang={lang}
        rec={showcase}
        proof={
          showcase && (
            <Suspense fallback={<ProofSkeleton lang={lang} />}>
              <ProofBody lang={lang} rec={showcase} />
            </Suspense>
          )
        }
      />
      <Numbers lang={lang} records={records} />
      <Trust lang={lang} />
      <Faq lang={lang} />
    </Shell>
  );
}
