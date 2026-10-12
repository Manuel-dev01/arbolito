import type { ReactNode } from "react";
import { LANG_LABEL, LANGS, messages, withLang, type Lang } from "../../i18n/messages";
import { MINIPAY_URL, TELEGRAM_URL } from "./links";

/** The three-dot mark (pink, lime, blue) and the wordmark, as in the design's nav. */
export function Brand({ lang }: { lang: Lang }) {
  return (
    <a className="brand" href={withLang("/", lang)} aria-label="Arbolito">
      <span className="brand-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="brand-word">arbolito</span>
    </a>
  );
}

/**
 * Public page shell: sticky glass nav, content, and the "pie" footer with the language switch.
 * `path` is the current path without ?lang, so the switch keeps the reader on the same page.
 * Everything public is scoped under `.pub` so it never leaks into the Mini App's styles.
 * `size`: "m" reading width (receipts), "l" for dashboards, "full" for the landing's full-bleed sections.
 */
export function Shell({ lang, path, children, size = "m" }: { lang: Lang; path: string; children: ReactNode; size?: "m" | "l" | "full" }) {
  const t = messages(lang);
  const onLanding = path === "/";
  const anchor = (id: string) => (onLanding ? `#${id}` : withLang(`/#${id}`, lang));
  return (
    <div className="pub" lang={lang}>
      <header className="nav-wrap">
        <nav className="nav" aria-label={t.nav.main}>
          <Brand lang={lang} />
          <div className="nav-links">
            <a href={anchor("como")}>{t.nav.how}</a>
            <a href={anchor("calc")}>{t.nav.calc}</a>
            <a href={anchor("recibo")}>{t.nav.receipts}</a>
            <a href={withLang("/metrics", lang)} aria-current={path === "/metrics" ? "page" : undefined}>
              {t.nav.live}
            </a>
            <a className="btn btn-primary btn-sm" href={MINIPAY_URL} rel="noopener">
              {t.nav.openMiniPay}
            </a>
          </div>
        </nav>
      </header>
      <main className={size === "full" ? "main main-wide" : size === "l" ? "main main-l" : "main"}>{children}</main>
      <footer className="pie" id="pie">
        <div className="pie-inner">
          <div className="pie-word" aria-hidden="true">
            arbolito<span>.</span>
          </div>
          <div className="pie-row">
            <div className="langs" role="group" aria-label={t.nav.language}>
              {LANGS.map((l) => (
                <a key={l} href={withLang(path, l)} hrefLang={l} lang={l} aria-current={l === lang ? "true" : undefined}>
                  {LANG_LABEL[l]}
                </a>
              ))}
            </div>
            <nav className="pie-links" aria-label={t.footer.links}>
              <a href={withLang("/metrics", lang)}>{t.nav.metrics}</a>
              <a href={anchor("recibo")}>{t.nav.receipts}</a>
              <a href={withLang("/desk", lang)}>{t.nav.desk}</a>
              <a href={TELEGRAM_URL} rel="noopener">
                Telegram
              </a>
            </nav>
            <span className="pie-beta mono">{t.footer.beta}</span>
          </div>
          <p className="pie-line">{t.footer.line}</p>
        </div>
      </footer>
    </div>
  );
}

export function ExtLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

/** Mono section label ("01 — CÓMO FUNCIONA"). */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={className ? `kicker ${className}` : "kicker"}>{children}</span>;
}

/** Display headline with an italic accent: "Tres pasos. <i>Cero</i> jerga." */
export function Display({ a, b, c, as = "h2", accent, className, id }: { a: string; b: string; c?: string; as?: "h1" | "h2"; accent?: "pink" | "lime"; className?: string; id?: string }) {
  const Tag = as;
  return (
    <Tag className={className ? `display ${className}` : "display"} id={id}>
      {a}
      <i className={accent ? `accent-${accent}` : undefined}>{b}</i>
      {c}
    </Tag>
  );
}
