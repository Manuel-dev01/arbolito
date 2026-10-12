"use client";

import { fill } from "../../../i18n/miniapp";
import { usdToCur } from "../../../lib/miniapp/client/derive";
import { fmtMoney, maskPhone } from "../../../lib/miniapp/client/format";
import { Frame, PRESETS, useApp, type Preset } from "../context";
import { Switch } from "../ui";

/** "≈ ARS 40.200" for a USD amount, in the display currency (empty when that is dollars). */
export function useLocalEq() {
  const { displayCur, prices, lang } = useApp();
  return (usd: number) => {
    if (displayCur === "USD") return "";
    const v = usdToCur(BigInt(Math.round(usd * 1e6)), displayCur, prices);
    return v === null ? "" : `≈ ${fmtMoney(v, 18, displayCur, lang, { dp: 0 })}`;
  };
}

const LOC = { es: "es-AR", pt: "pt-BR", en: "en-US" } as const;
export const fmtDate = (d: Date, lang: "es" | "pt" | "en") => d.toLocaleDateString(LOC[lang], { day: "numeric", month: "short", year: "numeric" }).replace(/\./g, "").replace(/ de /g, " ");

export function AutoIntro() {
  const { t, go } = useApp();
  const rows: [string, string][] = [
    [t.autoEx1T, t.auto1],
    [t.autoEx2T, t.auto2],
    [t.autoEx3T, t.auto3],
  ];
  return (
    <Frame primary={{ label: t.autoOn, onClick: () => go("auto-limits") }} secondary={{ label: t.notNow, onClick: () => go("home") }}>
      <div className="mp-pad wide">
        <h1 className="mp-h1">{t.conT}</h1>
        <p className="mp-p">{t.autoIntroB}</p>
        <div className="mp-card">
          {rows.map(([k, v], i) => (
            <div key={k} className="mp-col" style={{ padding: 16, borderBottom: i < 2 ? "1px solid var(--hairline)" : 0 }}>
              <span className="mp-kicker mp-save" style={{ fontSize: 12, color: "var(--save-text)" }}>
                {k}
              </span>
              <span style={{ fontSize: 16, lineHeight: 1.45 }}>{v}</span>
            </div>
          ))}
        </div>
        <div className="mp-small">{t.autoOpt}</div>
      </div>
    </Frame>
  );
}

export function AutoLimits() {
  const { t, autoDraft, setAutoDraft, go } = useApp();
  const eq = useLocalEq();
  const opts: [Preset, string][] = [
    ["low", t.limLow],
    ["mid", t.limMid],
    ["high", t.limHigh],
  ];
  return (
    <Frame primary={{ label: t.next, onClick: () => go("auto-contacts") }}>
      <div className="mp-pad wide" style={{ gap: 14 }}>
        <h1 className="mp-h1 md">{t.limT}</h1>
        <p className="mp-p">{t.limB}</p>
        <div role="radiogroup" aria-label={t.limT} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {opts.map(([k, label]) => {
            const [op, day] = PRESETS[k];
            const on = autoDraft.preset === k;
            return (
              <button key={k} type="button" role="radio" aria-checked={on} className={`mp-option radio ${on ? "on" : ""}`} onClick={() => setAutoDraft({ preset: k })}>
                <span className={`mp-radio ${on ? "on" : ""}`} />
                <span className="mp-grow mp-col" style={{ gap: 6 }}>
                  <span className="mp-row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 17, fontWeight: 700 }}>{label}</span>
                    {k === "mid" ? <span className="mp-tag save">{t.recTag}</span> : null}
                  </span>
                  <span style={{ fontSize: 16 }}>
                    US$ {op} {t.perOp} <span style={{ color: "var(--muted)" }}>{eq(op)}</span>
                  </span>
                  <span style={{ fontSize: 16 }}>
                    US$ {day} {t.perDay} <span style={{ color: "var(--muted)" }}>{eq(day)}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mp-small">{t.limNote2}</div>
      </div>
    </Frame>
  );
}

export function AutoContacts() {
  const { t, contacts, autoDraft, setAutoDraft, go } = useApp();
  const toggle = (id: string) => setAutoDraft({ contactIds: autoDraft.contactIds.includes(id) ? autoDraft.contactIds.filter((x) => x !== id) : [...autoDraft.contactIds, id] });
  return (
    <Frame primary={{ label: t.next, onClick: () => go("auto-consent") }}>
      <div className="mp-pad wide" style={{ gap: 14 }}>
        <h1 className="mp-h1 md">{t.ctT}</h1>
        <p className="mp-p">{t.ctB}</p>
        {contacts.length === 0 ? (
          <div className="mp-soft mp-small">{t.ctEmpty}</div>
        ) : (
          <div className="mp-card">
            {contacts.map((c) => {
              const on = autoDraft.contactIds.includes(c.id);
              const usable = !!c.address;
              return (
                <button key={c.id} type="button" role="switch" aria-checked={on} className="mp-list-row" disabled={!usable} onClick={() => usable && toggle(c.id)} style={{ opacity: usable ? 1 : 0.6 }}>
                  <span className="mp-avatar" style={{ width: 40, height: 40 }}>
                    {c.name[0]}
                  </span>
                  <span className="mp-grow mp-col" style={{ gap: 2 }}>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>{c.name}</span>
                    <span className="mp-mono" style={{ fontSize: 13, color: "var(--muted)" }}>
                      {usable ? (c.phone ? maskPhone(c.phone) : "") : t.ctNoAddr}
                    </span>
                  </span>
                  <Switch on={on && usable} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Frame>
  );
}

export function AutoConsent() {
  const { t, lang, contacts, autoDraft, go, activateAuto } = useApp();
  const eq = useLocalEq();
  const [op, day] = PRESETS[autoDraft.preset];
  const chosen = contacts.filter((c) => autoDraft.contactIds.includes(c.id) && c.address);
  const names = chosen.map((c) => c.name.split(" ")[0]).join(", ");
  const opEq = eq(op);
  const items = [
    chosen.length ? (
      <>
        {fill(t.con1, { k: chosen.length })} <b>{names}</b>
      </>
    ) : (
      t.con1none
    ),
    fill(t.con2, { op: `US$ ${op}${opEq ? ` (${opEq})` : ""}`, day: `US$ ${day}` }),
    t.con3,
    t.con4,
  ];
  return (
    <Frame
      note={t.mpNext}
      primary={autoDraft.busy ? { label: t.openingMP, kind: "busy" } : { label: t.turnOn, onClick: activateAuto }}
      secondary={{ label: t.cancel, onClick: () => go("home") }}
    >
      <div className="mp-pad wide" style={{ gap: 14 }} lang={lang}>
        <h1 className="mp-h1">{t.conT}</h1>
        <ul className="mp-card pad" style={{ margin: 0, listStyle: "none", padding: 18, gap: 14 }}>
          {items.map((it, i) => (
            <li key={i} className="mp-row" style={{ alignItems: "flex-start" }}>
              <span className="mp-circle" style={{ width: 26, height: 26, fontSize: 14, background: "var(--save-bg)", color: "var(--save-text)" }} aria-hidden="true">
                ✓
              </span>
              <span style={{ fontSize: 16, lineHeight: 1.45 }}>{it}</span>
            </li>
          ))}
        </ul>
        <div className="mp-col" style={{ background: "var(--danger-bg)", borderRadius: 14, padding: "14px 16px" }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "var(--danger)" }}>{t.conNever}</span>
          <span style={{ fontSize: 16, lineHeight: 1.45 }}>{t.conNever1}</span>
        </div>
      </div>
    </Frame>
  );
}

export function AutoOn() {
  const { t, lang, auto, contacts, autoDraft, go } = useApp();
  const [op, day] = PRESETS[autoDraft.preset];
  const names = contacts.filter((c) => autoDraft.contactIds.includes(c.id) && c.address).map((c) => c.name.split(" ")[0]).join(", ") || "—";
  const expiry = auto?.operatorExpiry ? new Date(auto.operatorExpiry) : new Date(Date.now() + 30 * 86_400_000);
  return (
    <Frame primary={{ label: t.setRule, onClick: () => go("chat") }} secondary={{ label: t.backHome, onClick: () => go("home") }}>
      <div className="mp-center">
        <div className="mp-circle ok" style={{ fontSize: 32 }}>
          ✓
        </div>
        <h1 className="mp-h1">{t.autoDoneT}</h1>
        <p className="mp-p">{t.autoDoneB}</p>
        <div style={{ borderTop: "1px dashed var(--hairline)" }}>
          {(
            [
              [t.limitsL, `US$ ${op} · US$ ${day}`],
              [t.contactsL, names],
              [t.conExp, fmtDate(expiry, lang)],
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k} className="mp-between" style={{ padding: "12px 0", borderBottom: "1px dashed var(--hairline)", fontSize: 16 }}>
              <span style={{ color: "var(--muted)" }}>{k}</span>
              <span style={{ fontWeight: 600, textAlign: "right" }}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
}
