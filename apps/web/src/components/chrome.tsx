import type { ReactNode } from "react";
import { LANGS, messages, withLang, type Lang } from "../i18n/messages";

export const TELEGRAM_URL = "https://t.me/arbolitoo_bot";

function TreeMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22v-7" />
      <path d="M12 15c-4.4 0-7-2.5-7-6a7 7 0 0 1 14 0c0 3.5-2.6 6-7 6Z" fill="currentColor" fillOpacity="0.15" />
      <path d="M12 15l-3-3M12 13l3-3" />
    </svg>
  );
}

/** Page shell: header with nav and language switch, footer. `path` is the current path without ?lang. */
export function Shell({ lang, path, children }: { lang: Lang; path: string; children: ReactNode }) {
  const t = messages(lang);
  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <a className="brand" href={withLang("/", lang)}>
            <TreeMark />
            Arbolito
          </a>
          <nav className="nav" aria-label="main">
            <a href={withLang("/metrics", lang)} aria-current={path === "/metrics" ? "page" : undefined}>
              {t.nav.metrics}
            </a>
            <a href={TELEGRAM_URL} rel="noopener">
              {t.nav.telegram}
            </a>
            <span className="langs" role="group" aria-label={t.nav.language}>
              {LANGS.map((l) => (
                <a key={l} href={withLang(path, l)} aria-current={l === lang ? "true" : undefined} hrefLang={l}>
                  {l}
                </a>
              ))}
            </span>
          </nav>
        </div>
      </header>
      <main className="wrap stack" lang={lang}>
        {children}
      </main>
      <footer className="wrap site-footer">{t.footer}</footer>
    </>
  );
}

export function ExtLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
