import { Shell } from "../components/chrome";
import { messages } from "../i18n/messages";

export default function NotFound() {
  const t = messages("es").receipt;
  return (
    <Shell lang="es" path="/">
      <section className="card">
        <h1>{t.notFoundTitle}</h1>
        <p className="muted">{t.notFoundBody}</p>
        <a className="btn" href="/">
          ← Arbolito
        </a>
      </section>
    </Shell>
  );
}
