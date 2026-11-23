"use client";

import { useState } from "react";
import { fill } from "../../../i18n/miniapp";
import { spendableBalance } from "../../../lib/miniapp/client/derive";
import { mapApiError } from "../../../lib/miniapp/client/errors";
import { CUR_OF, PREFIX, fmtMoney, fmtSym, parseHuman } from "../../../lib/miniapp/client/format";
import { canContinue, costCap, runFinished, type PayoutItem } from "../../../lib/miniapp/client/payout";
import { namesFragment, statementId } from "../../../lib/payout-link";
import { Frame, useApp } from "../context";
import { Badge, Spinner } from "../ui";
import { PAY_SYM, canExact, exactAmount, payable, payoutAmount } from "../use-payout";

const usd = (items: { amount: string }[]) => items.reduce((n, i) => n + parseHuman(i.amount, 6), 0n);

/** Who gets paid and how much: one amount per saved payee. */
export function PayoutPick() {
  const { t, lang, contacts, bal, prices, payout, go } = useApp();
  const list = contacts.filter(payable);
  const left = contacts.length - list.length;
  const value = (c: (typeof list)[number]) => (payout.exact[c.id] ? exactAmount(payout.amounts[c.id]) : payoutAmount(payout.amounts[c.id]));
  const picked = list.filter((c) => value(c) !== null);
  // Local amounts are estimated here; the review prices them.
  const total = picked.reduce((n, c) => n + (payout.exact[c.id] ? (parseHuman(value(c)!, 6) * (prices[c.cur] ?? 0n)) / 1_000_000n : parseHuman(value(c)!, 6)), 0n);
  const about = picked.some((c) => payout.exact[c.id]);
  const have = spendableBalance(bal.data, PAY_SYM);
  const over = bal.data !== null && total > have;
  const bad = list.some((c) => (payout.amounts[c.id] ?? "").trim() !== "" && value(c) === null);
  const primary = payout.reviewing
    ? { label: t.searching, kind: "busy" as const }
    : over
      ? { label: t.insufficient, kind: "off" as const }
      : !picked.length || bad
        ? { label: t.poReview, kind: "off" as const }
        : { label: `${t.poReview} · ${about ? "≈ " : ""}${fmtMoney(total, 6, "USD", lang)}`, onClick: payout.requestReview };
  if (!list.length)
    return (
      <Frame primary={{ label: t.addContact, onClick: () => go("send-add") }}>
        <div className="mp-center" style={{ gap: 12 }}>
          <h1 className="mp-h1 md">{t.poEmptyT}</h1>
          <p className="mp-p">{t.poEmptyB}</p>
        </div>
      </Frame>
    );
  return (
    <Frame note={bad ? t.poMin : undefined} primary={primary}>
      <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
        <h1 className="mp-h1 md">{t.poTitle}</h1>
        <p className="mp-p">{t.poLead}</p>
        <div className="mp-card">
          {list.map((c) => (
            <div key={c.id} className="mp-list-row" style={{ minHeight: 68 }}>
              <span className="mp-avatar">{c.name[0]}</span>
              <span className="mp-grow mp-col" style={{ gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 17, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <span className="mp-meta">{fill(t.receives, { c: t.curLower[c.cur] })}</span>
              </span>
              <span className="mp-row" style={{ gap: 6, flex: "none" }}>
                {canExact(c) ? (
                  <button type="button" className="mp-link inline" style={{ minWidth: 44, minHeight: 44 }} aria-label={fill(t.poSwitch, { n: c.name })} onClick={() => payout.setExact(c.id, !payout.exact[c.id])}>
                    {payout.exact[c.id] ? PREFIX[c.cur] : "US$"} ⇅
                  </button>
                ) : (
                  <span className="mp-meta">US$</span>
                )}
                <input
                  className="mp-input"
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={fill(payout.exact[c.id] ? t.poExactFor : t.poAmountFor, { n: c.name, c: t.curLower[c.cur] })}
                  value={payout.amounts[c.id] ?? ""}
                  onChange={(e) => payout.setAmount(c.id, e.target.value.replace(/[^\d.,]/g, "").slice(0, 12))}
                  placeholder="0"
                  style={{ width: 84, minHeight: 44, textAlign: "right" }}
                />
              </span>
            </div>
          ))}
        </div>
        <div className="mp-meta">
          {t.available} {fmtMoney(have, 6, "USD", lang)}
        </div>
        {list.some(canExact) ? <div className="mp-meta">{t.poExactNote}</div> : null}
        {left > 0 ? <div className="mp-soft mp-small">{t.poLeftOut}</div> : null}
        <button type="button" className="mp-link inline" style={{ alignSelf: "flex-start" }} onClick={() => go("send-add")}>
          + {t.addContact}
        </button>
      </div>
    </Frame>
  );
}

/** Everything at once, before anything is signed. */
export function PayoutReview() {
  const { t, lang, bal, payout, go } = useApp();
  const items = payout.review;
  if (!items?.length) return <PayoutPick />;
  const over = bal.data !== null && items.reduce((n, i) => n + costCap(i), 0n) > spendableBalance(bal.data, PAY_SYM);
  return (
    <Frame note={t.poSignNote} primary={over ? { label: t.insufficient, kind: "off" } : { label: fill(t.poConfirm, { n: String(items.length) }), onClick: payout.confirm }} secondary={{ label: t.cancel, onClick: () => go("payout") }}>
      <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
        <div className="mp-col" style={{ gap: 2 }}>
          <span className="mp-small">{t.aboutTo}</span>
          <span className="mp-amount" style={{ fontSize: 41, lineHeight: 1.05 }}>
            {fmtMoney(usd(items), 6, "USD", lang)}
          </span>
        </div>
        <div className="mp-card">
          {items.map((i) => (
            <div key={i.contactId} className="mp-list-row">
              <span className="mp-avatar">{i.name[0]}</span>
              <span className="mp-grow mp-col" style={{ gap: 2 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{i.name}</span>
                <span className="mp-meta">
                  {i.exact !== undefined ? "≈ " : ""}
                  {fmtMoney(parseHuman(i.amount, 6), 6, "USD", lang)}
                </span>
              </span>
              <span className="mp-save" style={{ fontSize: 17, fontWeight: 800 }}>
                {i.exact !== undefined ? "" : "≈ "}
                {fmtSym(i.reviewedOut, i.to, lang)}
              </span>
            </div>
          ))}
        </div>
        <div className="mp-soft mp-small">{t.poHoldNote}</div>
      </div>
    </Frame>
  );
}

function Row({ item, index }: { item: PayoutItem; index: number }) {
  const { t, lang, payout, openReceipt, toast } = useApp();
  const [sure, setSure] = useState(false);
  const live = payout.running && payout.stage?.index === index;
  const s = payout.stage?.stage;
  const line =
    live && s?.stage === "confirming"
      ? fill(t.confStep, { i: String(s.index + 1), n: String(s.total) })
      : live && s?.stage === "signing-proof"
        ? t.pProof
        : live
          ? t.poPaying
          : item.state === "paid"
            ? fmtSym(item.paidOut ?? item.reviewedOut, item.to, lang)
            : item.state === "held"
              ? item.heldOut
                ? item.exact !== undefined
                  ? fill(t.poHeldCost, { a: fmtMoney(BigInt(item.heldOut), 6, "USD", lang), b: fmtMoney(parseHuman(item.amount, 6), 6, "USD", lang) })
                  : fill(t.poHeld, { a: fmtSym(item.heldOut, item.to, lang), b: fmtSym(item.reviewedOut, item.to, lang) })
                : t.poStopped
              : item.state === "converted"
                ? fill(t.convNotSentB, { y: t.curLower[CUR_OF[item.to]], n: item.name })
                : item.state === "unknown"
                  ? t.poUnknown
                  : item.state === "stopped"
                    ? item.error && mapApiError(item.error).kind === "no-market"
                      ? t.poNoMarket
                      : t.poStopped
                    : t.poWaiting;
  return (
    <div className="mp-list-row" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
      <Badge cur={CUR_OF[item.to]} size={36} />
      <span className="mp-grow mp-col" style={{ gap: 2, minWidth: 0 }}>
        <span className="mp-between">
          <span style={{ fontSize: 16, fontWeight: 600 }}>{item.name}</span>
          <span className="mp-row" style={{ gap: 6 }}>
            {live ? <Spinner size={14} /> : null}
            <span className="mp-meta">{item.state === "paid" ? `✓ ${t.poPaid}` : fmtMoney(parseHuman(item.amount, 6), 6, "USD", lang)}</span>
          </span>
        </span>
        <span className={item.state === "paid" && !live ? "mp-save" : "mp-meta"} style={item.state === "unknown" || item.state === "converted" ? { color: "var(--danger)" } : undefined}>
          {line}
        </span>
        {payout.running ? null : item.state === "paid" && item.receiptId ? (
          <button type="button" className="mp-link inline" style={{ alignSelf: "flex-start" }} onClick={() => openReceipt(item.receiptId!)}>
            {t.seeReceipt}
          </button>
        ) : item.state === "held" && item.heldOut ? (
          <button type="button" className="mp-link inline" style={{ alignSelf: "flex-start" }} onClick={() => payout.acceptHeld(index)}>
            {t.poAccept}
          </button>
        ) : item.state === "unknown" ? (
          <span className="mp-row" style={{ gap: 16, flexWrap: "wrap" }}>
            <button type="button" className="mp-link inline" onClick={() => payout.resolveUnknown(index, "paid")}>
              {t.poWasPaid}
            </button>
            <button
              type="button"
              className="mp-link muted inline"
              onClick={() => {
                // Paying twice is the one mistake that can't be undone: it takes two taps.
                if (!sure) {
                  setSure(true);
                  return toast(t.poSure);
                }
                payout.resolveUnknown(index, "not-sent");
              }}
            >
              {sure ? t.poNotSentSure : t.poNotSent}
            </button>
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Progress while paying, then the result: what was paid, what wasn't, and the statement to share. */
export function PayoutProgress() {
  const { t, lang, payout, go, openLink, toast, mock } = useApp();
  const [names, setNames] = useState(true);
  const run = payout.run;
  if (!run) return <PayoutPick />;
  const paid = run.items.filter((i) => i.state === "paid" && i.receiptId);
  const id = statementId(paid.map((i) => i.receiptId!));
  const path = id ? `/payouts/${id}?lang=${lang}${names ? namesFragment(paid.map((i) => i.name)) : ""}` : null;
  const share = () => {
    if (!path) return;
    if (mock) return toast(t.poDemoLink);
    navigator.clipboard?.writeText(`${window.location.origin}${path}`).then(
      () => toast(t.poLinkCopied),
      () => openLink(path),
    );
  };
  const more = canContinue(run);
  const done = runFinished(run);
  const primary = payout.running
    ? { label: t.poPaying, kind: "busy" as const }
    : more
      ? { label: t.poContinue, onClick: payout.resume }
      : path
        ? { label: t.poStatement, onClick: () => (mock ? toast(t.poDemoLink) : openLink(path)) }
        : { label: t.backHome, onClick: () => go("home") };
  return (
    <Frame
      note={payout.running ? t.poKeepOpen : undefined}
      primary={primary}
      secondary={
        payout.running
          ? null
          : done
            ? {
                label: t.backHome,
                onClick: () => {
                  payout.clear();
                  go("home", { replace: true });
                },
              }
            : { label: t.backHome, onClick: () => go("home") }
      }
    >
      <div className="mp-pad" style={{ gap: 14, paddingTop: 4 }}>
        <h1 className="mp-h1 md">{payout.running ? t.poRunT : done ? t.poDoneT : fill(t.poPartT, { a: String(run.items.filter((i) => i.state === "paid").length), b: String(run.items.length) })}</h1>
        <div className="mp-card" aria-live="polite">
          {run.items.map((i, n) => (
            <Row key={`${i.contactId}-${n}`} item={i} index={n} />
          ))}
        </div>
        {!payout.running && path ? (
          <div className="mp-soft mp-col" style={{ gap: 10 }}>
            <span className="mp-small">{t.poStatementB}</span>
            <label className="mp-row" style={{ gap: 10, minHeight: 44 }}>
              <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} style={{ width: 20, height: 20 }} />
              <span className="mp-small">{t.poNames}</span>
            </label>
            <button type="button" className="mp-link inline" style={{ alignSelf: "flex-start" }} onClick={share}>
              {t.poCopyLink}
            </button>
          </div>
        ) : null}
        {!payout.running && !more && !done ? (
          <button type="button" className="mp-link muted inline" style={{ alignSelf: "flex-start" }} onClick={payout.clear}>
            {t.poClear}
          </button>
        ) : null}
      </div>
    </Frame>
  );
}
