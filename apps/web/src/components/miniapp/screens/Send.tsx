"use client";

import { useEffect, useRef, useState } from "react";
import { fill } from "../../../i18n/miniapp";
import { countdown } from "../../../lib/miniapp/client/countdown";
import { balanceOf, usdToCur } from "../../../lib/miniapp/client/derive";
import { CURS, DECIMALS, fmtMoney, fmtPct, fmtRateLine, fmtSym, fmtTyped, gainOf, maskPhone, parseHuman, SYM_OF, type Cur } from "../../../lib/miniapp/client/format";
import { isPositive } from "../../../lib/miniapp/client/keypad";
import { newId, type Contact } from "../../../lib/miniapp/client/store";
import { Frame, useApp, useNow } from "../context";
import { Badge, CountdownBar, CountdownText } from "../ui";
import { CurPill, Keypad, MiniPayReceiptLink, ReceiptChip } from "./Change";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const first = (name: string) => name.split(" ")[0] ?? name;

/** Contact picked from MiniPay's native picker, handed to the add form. */
let picked: { name: string; address: string } | null = null;

function usePickFromMiniPay() {
  const { wallet, toast, t, go } = useApp();
  return async () => {
    toast(t.toastContacts);
    const c = await wallet.requestContact();
    if (!c) return toast(t.noContactPicked);
    picked = c;
    go("send-add");
  };
}

export function SendList() {
  const { t, contacts, setSend, go } = useApp();
  const pick = usePickFromMiniPay();
  const [q, setQ] = useState("");
  if (contacts.length === 0)
    return (
      <Frame primary={{ label: t.addContact, onClick: () => go("send-add") }}>
        <div className="mp-center" style={{ gap: 16 }}>
          <div className="mp-circle" style={{ width: 72, height: 72, border: "2px dashed var(--hairline)", color: "var(--muted)", fontSize: 28 }}>
            +
          </div>
          <h1 className="mp-h1 md">{t.sendEmptyT}</h1>
          <p className="mp-p">{t.sendEmptyB}</p>
          <button type="button" className="mp-link inline" style={{ alignSelf: "flex-start", fontSize: 16, minHeight: 48 }} onClick={() => void pick()}>
            {t.fromPhone}
          </button>
        </div>
      </Frame>
    );
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const shown = contacts.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.tag.toLowerCase().includes(needle) || (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits)));
  return (
    <div className="mp-scroll">
      <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
        <h1 className="mp-h1 md">{t.sendTitle}</h1>
        <input className="mp-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} style={{ minHeight: 48 }} />
        <div className="mp-card">
          {shown.length === 0 ? <div style={{ padding: 16 }} className="mp-small">{t.noMatch}</div> : null}
          {shown.map((c) => (
            <button
              key={c.id}
              type="button"
              className="mp-list-row"
              style={{ minHeight: 68 }}
              onClick={() => {
                setSend({ contactId: c.id, quote: null, amount: "20" });
                go("send-amount");
              }}
            >
              <span className="mp-avatar">{c.name[0]}</span>
              <span className="mp-grow mp-col" style={{ gap: 2 }}>
                <span style={{ fontSize: 17, fontWeight: 600 }}>{c.name}</span>
                <span className="mp-meta">
                  {fill(t.receives, { c: t.curLower[c.cur] })}
                  {c.tag ? ` · ${c.tag}` : ""}
                </span>
                {c.phone ? (
                  <span className="mp-mono" style={{ fontSize: 13, color: "var(--muted)" }}>
                    {maskPhone(c.phone)}
                  </span>
                ) : null}
              </span>
              <Badge cur={c.cur} size={32} />
            </button>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button type="button" className="mp-btn quiet" style={{ borderRadius: 14, minHeight: 52, fontSize: 16 }} onClick={() => go("send-add")}>
            + {t.addContact}
          </button>
          <button type="button" className="mp-link" style={{ minHeight: 48, fontSize: 16 }} onClick={() => void pick()}>
            {t.fromPhone}
          </button>
        </div>
        <div className="mp-meta">{t.sendSafety}</div>
      </div>
    </div>
  );
}

export function SendAdd() {
  const { t, lang, saveContact, setSend, go, toast } = useApp();
  const pick = usePickFromMiniPay();
  const [init] = useState(() => {
    const p = picked;
    picked = null;
    return p;
  });
  const [phone, setPhone] = useState("");
  const [name, setName] = useState(init?.name ?? "");
  const [tag, setTag] = useState("");
  const [cur, setCur] = useState<Cur>(lang === "pt" ? "BRL" : "ARS");
  const [address, setAddress] = useState(init?.address ?? "");
  const [details, setDetails] = useState(false);
  const fromPicker = !!init && address === init.address;
  const badAddr = address.trim() !== "" && !ADDRESS_RE.test(address.trim());
  const ok = name.trim().length > 0 && (phone.trim().length > 0 || ADDRESS_RE.test(address.trim())) && !badAddr;
  const save = () => {
    const c: Contact = { id: newId(), name: name.trim(), tag: tag.trim(), phone: phone.trim(), cur, address: ADDRESS_RE.test(address.trim()) ? address.trim() : null };
    saveContact(c);
    toast(t.toastSaved);
    setSend({ contactId: c.id, quote: null, amount: "20" });
    go("send-amount", { replace: true });
  };
  return (
    <Frame primary={ok ? { label: t.saveContact, onClick: save } : { label: t.saveContact, kind: "off" }}>
      <div className="mp-pad" style={{ paddingTop: 4 }}>
        <label className="mp-field">
          <span>{t.phoneLbl}</span>
          <input className={`mp-input mono ${fromPicker ? "ok" : ""}`} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+54 9 11 …" />
          {fromPicker ? (
            <span className="mp-save" style={{ fontSize: 14, fontWeight: 700 }}>
              ✓ {t.lookupOk}
            </span>
          ) : phone.trim() && !address ? (
            <span className="mp-meta">{t.lookupNo}</span>
          ) : null}
        </label>
        <label className="mp-field">
          <span>{t.nameLbl}</span>
          <input className="mp-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="mp-field">
          <span>{t.tagLbl}</span>
          <input className="mp-input" value={tag} onChange={(e) => setTag(e.target.value)} placeholder={t.tagPh} />
        </label>
        <div className="mp-field">
          <span>{t.recvIn}</span>
          <div className="mp-seg">
            {CURS.map((c) => (
              <button key={c} type="button" aria-pressed={cur === c} onClick={() => setCur(c)}>
                {t.curName[c]}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="mp-link inline" style={{ alignSelf: "flex-start" }} onClick={() => void pick()}>
          {t.fromPhone}
        </button>
        <div className="mp-soft mp-small">{t.addNote}</div>
        <button type="button" className="mp-link muted inline" style={{ alignSelf: "flex-start" }} onClick={() => setDetails(!details)} aria-expanded={details}>
          {details ? t.hideDetails : t.showDetails}
        </button>
        {details ? (
          <label className="mp-field">
            <span>{t.addrLbl}</span>
            <input className="mp-input mono" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <span className="mp-meta" style={{ color: badAddr ? "var(--danger)" : undefined }}>
              {badAddr ? t.addrBad : t.addrHelp}
            </span>
          </label>
        ) : null}
      </div>
    </Frame>
  );
}

const CYCLE: Cur[] = ["USD", "BRL", "ARS"];

export function SendAmount() {
  const { t, lang, contacts, send, setSend, bal, prices, requestSendQuote } = useApp();
  const c = contacts.find((x) => x.id === send.contactId);
  if (!c) return <SendList />;
  const paySym = SYM_OF[send.pay];
  const have = balanceOf(bal.data, paySym);
  const over = bal.data !== null && isPositive(send.amount) && parseHuman(send.amount, DECIMALS[paySym]) > have;
  const pf = prices[send.pay];
  const est = send.pay === c.cur ? (isPositive(send.amount) ? parseHuman(send.amount, 18) : null) : pf && isPositive(send.amount) ? usdToCur((parseHuman(send.amount, 18) * pf) / 10n ** 18n, c.cur, prices) : null;
  const primary = !isPositive(send.amount) || over ? { label: over ? t.insufficient : t.reviewSend, kind: "off" as const } : send.busy ? { label: t.searching, kind: "busy" as const } : { label: t.reviewSend, onClick: requestSendQuote };
  return (
    <Frame primary={primary}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, padding: "0 16px 8px" }}>
        <div className="mp-row" style={{ padding: "4px 0" }}>
          <span className="mp-avatar" style={{ width: 40, height: 40 }}>
            {c.name[0]}
          </span>
          <span className="mp-col" style={{ gap: 2 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{c.name}</span>
            {c.phone ? (
              <span className="mp-mono" style={{ fontSize: 13, color: "var(--muted)" }}>
                {maskPhone(c.phone)}
              </span>
            ) : null}
          </span>
        </div>
        <div className="mp-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="mp-between">
            <span className="mp-small">{t.sendLbl}</span>
            <CurPill cur={send.pay} onClick={() => setSend({ pay: CYCLE[(CYCLE.indexOf(send.pay) + 1) % 3]!, quote: null })} />
          </div>
          <div className="mp-amount" style={{ fontSize: 43 }} aria-live="polite">
            {fmtTyped(send.amount, send.pay, lang)}
            <span className="mp-caret" aria-hidden="true" />
          </div>
          <div className="mp-meta">
            {t.available} {fmtSym(have, paySym, lang)}
          </div>
        </div>
        <div className="mp-sunk">
          <div className="mp-between">
            <span className="mp-small">{fill(t.recvX, { n: first(c.name) })}</span>
            <CurPill cur={c.cur} />
          </div>
          <div className="mp-amount mp-save" style={{ fontSize: 36 }}>
            {est !== null ? `${send.pay === c.cur ? "" : "≈ "}${fmtMoney(est, 18, c.cur, lang)}` : "—"}
          </div>
        </div>
        <Keypad value={send.amount} onChange={(v) => setSend({ amount: v, quote: null })} />
      </div>
    </Frame>
  );
}

export function SendQuote() {
  const { t, lang, contacts, send, setSheet, go, confirmSend, requestSendQuote, toast } = useApp();
  const now = useNow();
  const c = contacts.find((x) => x.id === send.contactId);
  const q = send.quote;
  const exp = q ? Date.parse(q.expiresAt) : 0;
  const cd = q ? countdown(exp, now, exp - send.quoteAt) : null;
  const refreshed = useRef<string | null>(null);
  // Design: an expired send quote refreshes by itself (with a toast) instead of dimming.
  useEffect(() => {
    if (q && cd?.phase === "expired" && !send.busy && refreshed.current !== q.quoteId) {
      refreshed.current = q.quoteId;
      requestSendQuote();
      toast(t.toastRefreshed);
    }
  }, [q, cd?.phase, send.busy, requestSendQuote, toast, t]);
  if (!c) return <SendList />;
  const pay = q ? fmtSym(q.amountIn, q.from, lang) : fmtMoney(parseHuman(send.amount || "0", 18), 18, send.pay, lang);
  const get = q ? fmtSym(q.expectedOut, q.to, lang) : fmtMoney(parseHuman(send.amount || "0", 18), 18, c.cur, lang);
  return (
    <Frame
      note={c.address ? t.mpNext : t.needAddr}
      primary={send.busy ? { label: t.openingMP, kind: "busy" } : c.address ? { label: t.confirmMP, onClick: confirmSend } : { label: t.confirmMP, kind: "off" }}
      secondary={{ label: t.cancel, onClick: () => go("send") }}
    >
      <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
        <div className="mp-card">
          {cd ? <CountdownBar cd={cd} /> : null}
          <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="mp-between">
              <span className="mp-small">{t.aboutTo}</span>
              {cd ? <CountdownText cd={cd} t={t} /> : null}
            </div>
            <div className="mp-amount" style={{ fontSize: 41, lineHeight: 1.05 }}>
              {pay}
            </div>
            <div className="mp-col" style={{ gap: 2, padding: "12px 14px", borderRadius: 14, background: "var(--save-bg)", color: "var(--save-text)" }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{fill(t.recvX, { n: first(c.name) })}</span>
              <span className="mp-amount" style={{ fontSize: 31 }}>
                {get}
              </span>
            </div>
          </div>
          <div style={{ padding: "0 18px 6px" }}>
            <div className="mp-kv">
              <span>{t.to}</span>
              <span className="mp-col" style={{ alignItems: "flex-end", gap: 2 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{c.name}</span>
                {c.phone ? (
                  <span className="mp-mono" style={{ fontSize: 13, color: "var(--muted)" }}>
                    {maskPhone(c.phone)}
                  </span>
                ) : null}
              </span>
            </div>
            {q ? (
              <div className="mp-kv">
                <span>{t.rate}</span>
                <span className="mp-mono" style={{ fontSize: 14 }}>
                  {fmtRateLine(q.rate, q.from, q.to, lang)} {q.vsOfficial ? <b className={gainOf(q.vsOfficial) ? "mp-save" : undefined}>{fmtPct(q.vsOfficial.pct, lang)}</b> : null}
                </span>
              </div>
            ) : null}
            <div className="mp-kv">
              <span>{t.arrivesL}</span>
              <span>{t.arrives}</span>
            </div>
          </div>
        </div>
        {q ? (
          <button type="button" className="mp-link" style={{ alignSelf: "center" }} onClick={() => setSheet("details")}>
            {t.details}
          </button>
        ) : null}
      </div>
    </Frame>
  );
}

export function SendDone() {
  const { t, lang, exec, contacts, send, go, openReceipt, openLink, toast, mock } = useApp();
  const c = contacts.find((x) => x.id === send.contactId);
  const got = exec.to && exec.expectedOut ? fmtSym(exec.expectedOut, exec.to, lang) : "";
  const pay = exec.from && exec.amountIn ? fmtSym(exec.amountIn, exec.from, lang) : "";
  const name = exec.contactName ?? (c ? first(c.name) : "");
  const tellWhatsApp = () => {
    toast(t.toastWA);
    const digits = (c?.phone ?? "").replace(/\D/g, "");
    if (!mock && digits) openLink(`https://wa.me/${digits}?text=${encodeURIComponent(fill(t.sentB, { n: name, x: got }))}`);
  };
  return (
    <Frame primary={exec.receiptId ? { label: t.seeReceipt, onClick: () => openReceipt(exec.receiptId!) } : { label: t.backHome, onClick: () => go("home") }} secondary={{ label: t.notifyContact, onClick: tellWhatsApp }}>
      <div className="mp-center">
        <div className="mp-circle ok" style={{ fontSize: 32 }}>
          ✓
        </div>
        <div className="mp-col" style={{ gap: 6 }}>
          <h1 className="mp-h1 lg">{t.sentT}</h1>
          <div style={{ fontSize: 18, lineHeight: 1.4 }}>{fill(t.sentB, { n: name, x: got })}</div>
          <div style={{ fontSize: 16, color: "var(--muted)" }}>{fill(t.doneSub, { y: pay })}</div>
        </div>
        {exec.receiptId ? <ReceiptChip receiptId={exec.receiptId} /> : null}
        <MiniPayReceiptLink />
      </div>
    </Frame>
  );
}
