import { describe, expect, it } from "vitest";
import { getLang, LANGS, MESSAGES, withLang } from "../src/i18n/messages";

/** Every key path in a message tree, with arrays indexed and functions marked. */
function shape(v: unknown, path = ""): string[] {
  if (typeof v === "function") return [`${path}()`];
  if (Array.isArray(v)) return [`${path}[${v.length}]`, ...v.flatMap((x, i) => shape(x, `${path}[${i}]`))];
  if (v && typeof v === "object") return Object.keys(v).flatMap((k) => shape((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  return [path];
}

const allStrings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(allStrings) : v && typeof v === "object" ? Object.values(v).flatMap(allStrings) : [];

describe("public site copy", () => {
  it("pt and en mirror the Spanish source key for key", () => {
    const es = shape(MESSAGES.es).sort();
    expect(shape(MESSAGES.pt).sort()).toEqual(es);
    expect(shape(MESSAGES.en).sort()).toEqual(es);
  });

  it("has no empty strings", () => {
    for (const l of LANGS) for (const s of allStrings(MESSAGES[l])) expect(s.trim()).not.toBe("");
  });

  it("keeps the calculator's client placeholders in every language", () => {
    for (const l of LANGS) {
      const c = MESSAGES[l].landing.calc;
      expect(c.more).toContain("{x}");
      expect(c.less).toContain("{x}");
      for (const k of ["{t}", "{u}", "{p}"]) {
        expect(c.noteLive).toContain(k);
        expect(c.noteReceipt).toContain(k);
      }
      expect(MESSAGES[l].landing.recibo.registered).toContain("{b}");
      expect(MESSAGES[l].landing.recibo.okSub).toContain("{d}");
    }
  });

  it("answers the FAQ the brief asks for: Ripio cash-out, no Arbolito fee in beta, MiniPay countries", () => {
    for (const l of LANGS) {
      const text = MESSAGES[l].landing.faq.items.map((f) => `${f.q} ${f.a}`).join(" ");
      expect(text).toContain("Ripio");
      expect(text).toMatch(/0[,.]01–0[,.]02/);
      for (const country of [/Argentin/, /Bra[sz]il/, /Chile/, /Col[oô]mbi/, /Per[uú]/, /Urugua/, /M[eé]xico/]) expect(text).toMatch(country);
    }
  });

  it("names the MiniPay and Telegram CTAs and marks the desk as coming soon", () => {
    expect(MESSAGES.es.landing.hero.ctaMiniPay).toBe("Abrir en MiniPay");
    expect(MESSAGES.es.landing.hero.ctaTelegram).toBe("Abrir en Telegram");
    expect(MESSAGES.es.desk.kicker).toBe("Arbolito Desk · pronto");
    expect(MESSAGES.es.landing.hero.titleA + MESSAGES.es.landing.hero.titleB + MESSAGES.es.landing.hero.titleC).toBe("El cambista que vive en tu chat.");
  });

  it("carries ?lang= through links for pt and en only", () => {
    expect(withLang("/metrics", "es")).toBe("/metrics");
    expect(withLang("/metrics", "pt")).toBe("/metrics?lang=pt");
    expect(withLang("/#calc", "en")).toBe("/?lang=en#calc");
    expect(withLang("/r/abc#verificacion", "en")).toBe("/r/abc?lang=en#verificacion");
    expect(getLang(["en", "pt"])).toBe("en");
    expect(getLang("fr")).toBe("es");
  });
});
