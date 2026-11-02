import { headers } from "next/headers";
import { Shell } from "../components/chrome";
import { messages } from "../i18n/messages";

/** A 404 can't see ?lang=, so it follows the browser's language (Spanish by default). */
async function browserLang(): Promise<"es" | "pt" | "en"> {
  const al = ((await headers()).get("accept-language") ?? "").toLowerCase();
  const first = al.split(",")[0]?.trim() ?? "";
  return first.startsWith("pt") ? "pt" : first.startsWith("en") ? "en" : "es";
}

export default async function NotFound() {
  const lang = await browserLang();
  const t = messages(lang).receipt;
  return (
    <Shell lang={lang} path="/">
      <section className="card">
        <h1>{t.pageNotFoundTitle}</h1>
        <p className="muted">{t.pageNotFoundBody}</p>
        <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a className="btn" href={lang === "es" ? "/app" : `/app?lang=${lang}`}>
            {t.openApp}
          </a>
          <a className="btn" href={lang === "es" ? "/" : `/?lang=${lang}`}>
            ← Arbolito
          </a>
        </p>
      </section>
    </Shell>
  );
}
