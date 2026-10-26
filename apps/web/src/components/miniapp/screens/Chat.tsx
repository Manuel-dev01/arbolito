"use client";

import { useEffect, useRef, useState } from "react";
import { fill } from "../../../i18n/miniapp";
import type { Quote } from "../../../lib/miniapp/client/api";
import { countdown } from "../../../lib/miniapp/client/countdown";
import { fmtPct, fmtRateLine, fmtSaved, fmtSym, gainOf, receiptRef } from "../../../lib/miniapp/client/format";
import { useApp, useNow, type ChatMsg } from "../context";
import { CountdownBar, CountdownText, Spinner } from "../ui";
import { routeText } from "./Change";

function ChatQuote({ m, now }: { m: Extract<ChatMsg, { kind: "quote" }>; now: number }) {
  const { t, lang, chatConfirm, chatAlts, chatCancel, chatRefresh } = useApp();
  const q: Quote = m.quote;
  const exp = Date.parse(q.expiresAt);
  const cd = countdown(exp, now, exp - m.at);
  const expired = cd.phase === "expired" && (m.status === "live" || m.status === "busy");
  const rows: [string, string, "mono" | "save" | "text"][] = [
    [t.rate, fmtRateLine(q.rate, q.from, q.to, lang), "mono"],
    ...(q.vsOfficial
      ? gainOf(q.vsOfficial)
        ? ([[t.vsOff, `${fmtPct(q.vsOfficial.pct, lang)} · ${fill(t.saved, { x: fmtSaved(q.vsOfficial.deltaOut, q.to, lang) })}`, "save"]] as [string, string, "save"][])
        : ([[t.vsOff, fmtPct(q.vsOfficial.pct, lang), "mono"]] as [string, string, "mono"][])
      : []),
    ...(q.vsWesternUnion
      ? ([[t.vsWU, q.vsWesternUnion.pct > 0 ? `${fmtPct(q.vsWesternUnion.pct, lang)} · ${fill(t.wuMore, { x: fmtSaved(q.vsWesternUnion.deltaOut, q.to, lang) })}` : `${fmtPct(q.vsWesternUnion.pct, lang)} · ${t.wuBeforeFee}`, q.vsWesternUnion.pct > 0 ? "save" : "mono"]] as [string, string, "save" | "mono"][])
      : []),
    [t.route, routeText(q, t), "text"],
    [t.minimum, fmtSym(q.minOut, q.to, lang), "mono"],
  ];
  return (
    <div className={`mp-chat-card ${m.status === "cancelled" || expired ? "" : ""}`}>
      <CountdownBar cd={m.status === "live" || m.status === "busy" ? cd : { ...cd, fraction: 0 }} />
      <div className={expired ? "mp-dim" : ""} style={{ padding: "14px 16px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="mp-between">
          <span className="mp-meta">{t.chGet}</span>
          {m.status === "live" || m.status === "busy" ? <CountdownText cd={cd} t={t} /> : null}
        </div>
        <div className="mp-amount" style={{ fontSize: 34 }}>
          {fmtSym(q.expectedOut, q.to, lang)}
        </div>
        <div style={{ fontSize: 15, color: "var(--muted)" }}>{fill(t.forX, { x: fmtSym(q.amountIn, q.from, lang) })}</div>
      </div>
      <div className={expired ? "mp-dim" : ""} style={{ padding: "0 16px" }}>
        {rows.map(([k, v, s]) => (
          <div key={k} className="mp-kv" style={{ padding: "9px 0", lineHeight: 1.35 }}>
            <span>{k}</span>
            <span className={s === "mono" ? "mp-mono" : s === "save" ? "mp-save" : ""} style={{ fontSize: s === "mono" ? 14 : 15, fontWeight: s === "save" ? 700 : 400, textWrap: "pretty" }}>
              {v}
            </span>
          </div>
        ))}
      </div>
      {expired ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
          <div className="mp-banner" style={{ fontSize: 15, borderRadius: 10 }}>
            {t.expired}. {t.noMoneyMoved}
          </div>
          <button type="button" className="mp-btn" style={{ borderRadius: 12, minHeight: 48, fontSize: 16 }} onClick={() => chatRefresh(m.id)}>
            {t.refresh}
          </button>
        </div>
      ) : m.status === "live" || m.status === "busy" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 12 }}>
          <button type="button" className={`mp-btn ${m.status === "busy" ? "busy" : ""}`} style={{ borderRadius: 12, minHeight: 48, fontSize: 16 }} disabled={m.status === "busy"} onClick={() => chatConfirm(m.id)}>
            {m.status === "busy" ? <Spinner size={16} color="currentColor" /> : null}
            {m.status === "busy" ? t.openingMP : t.confirmMP}
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <button type="button" className="mp-btn quiet" style={{ borderRadius: 12, minHeight: 44, fontSize: 15, fontWeight: 600 }} onClick={() => chatAlts(m.id)}>
              {t.altsShort}
            </button>
            <button type="button" className="mp-btn quiet" style={{ borderRadius: 12, minHeight: 44, fontSize: 15, fontWeight: 600 }} disabled={m.status === "busy"} onClick={() => chatCancel(m.id)}>
              {t.cancel}
            </button>
          </div>
        </div>
      ) : m.status === "used" ? (
        <div className="mp-save" style={{ padding: "12px 16px", borderTop: "1px dashed var(--hairline)", fontSize: 15, fontWeight: 600 }}>
          ✓ {t.pA}
        </div>
      ) : m.status === "failed" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
          <button type="button" className="mp-btn" style={{ borderRadius: 12, minHeight: 48, fontSize: 16 }} onClick={() => chatRefresh(m.id)}>
            {t.refresh}
          </button>
        </div>
      ) : (
        <div style={{ height: 10 }} />
      )}
    </div>
  );
}

/** A drafted automatic rule: the user turns it on by signing its text in MiniPay. */
function ChatRule({ m }: { m: Extract<ChatMsg, { kind: "rule" }> }) {
  const { t, chatRuleConfirm } = useApp();
  return (
    <div className="mp-chat-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <span className="mp-kicker mp-save" style={{ fontSize: 12, color: "var(--save-text)" }}>
        {t.ruleKicker}
      </span>
      <span style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.4 }}>{m.rule.description}</span>
      {m.status === "active" ? (
        <span className="mp-row mp-save" style={{ gap: 8, fontWeight: 700 }}>
          ✓ {t.ruleOnT}
        </span>
      ) : (
        <>
          <span className="mp-small">{t.ruleSignNote}</span>
          <button type="button" className={`mp-btn ${m.status === "busy" ? "busy" : ""}`} style={{ borderRadius: 12, minHeight: 48, fontSize: 16 }} disabled={m.status === "busy"} onClick={() => chatRuleConfirm(m.id)}>
            {m.status === "busy" ? <Spinner size={16} color="currentColor" /> : null}
            {m.status === "busy" ? t.openingMP : t.ruleSign}
          </button>
        </>
      )}
    </div>
  );
}

const WAVE = [10, 18, 12, 20, 8, 14, 16, 9];

function Message({ m, now }: { m: ChatMsg; now: number }) {
  const { t, openReceipt, chatRefresh } = useApp();
  switch (m.kind) {
    case "bot":
      return <div className="mp-bubble bot">{m.text}</div>;
    case "user":
      return <div className="mp-bubble user">{m.text}</div>;
    case "voice":
      return (
        <div className="mp-bubble user" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="mp-row" style={{ gap: 10 }}>
            <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--bg)", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }} aria-hidden="true">
              ▶
            </span>
            <span style={{ display: "flex", gap: 3, alignItems: "center" }} aria-hidden="true">
              {WAVE.map((h, i) => (
                <span key={i} style={{ width: 3, height: h, borderRadius: 2, background: "currentColor", opacity: 0.7 }} />
              ))}
            </span>
            <span className="mp-mono" style={{ fontSize: 13, opacity: 0.8 }}>
              0:{String(Math.max(1, Math.round(m.secs))).padStart(2, "0")}
            </span>
          </div>
          {m.text ? <div style={{ fontSize: 15, lineHeight: 1.4, fontStyle: "italic", opacity: 0.9 }}>{m.text}</div> : null}
        </div>
      );
    case "typing":
      return (
        <div className="mp-bubble bot" style={{ display: "flex", gap: 5, padding: "14px 16px" }} aria-label="…">
          <span className="mp-dot" />
          <span className="mp-dot" style={{ animationDelay: ".2s" }} />
          <span className="mp-dot" style={{ animationDelay: ".4s" }} />
        </div>
      );
    case "quote":
      return <ChatQuote m={m} now={now} />;
    case "proc":
      return (
        <div className="mp-bubble bot mp-row" style={{ gap: 10 }}>
          <Spinner />
          <span>{m.text}</span>
        </div>
      );
    case "done":
      return (
        <div className="mp-chat-card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="mp-row" style={{ gap: 10 }}>
            <span className="mp-circle ok" style={{ width: 28, height: 28, fontSize: 15 }}>
              ✓
            </span>
            <span style={{ fontSize: 17, fontWeight: 700 }}>{m.title}</span>
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.45, color: "var(--muted)" }}>{m.text}</div>
          {m.receiptId ? (
            <button type="button" className="mp-btn quiet" style={{ borderRadius: 12, minHeight: 44, fontSize: 15 }} onClick={() => openReceipt(m.receiptId!)}>
              {t.seeReceipt} · {receiptRef(m.receiptId)}
            </button>
          ) : null}
        </div>
      );
    case "rule":
      return <ChatRule m={m} />;
    case "cancel":
      return (
        <div className="mp-bubble bot" style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: "90%" }}>
          <span>
            {t.cancelT}. {t.noMoneyMoved}
          </span>
          <button type="button" className="mp-btn quiet" style={{ borderRadius: 12, minHeight: 44, fontSize: 15 }} onClick={() => chatRefresh(m.quoteMsgId)}>
            {t.backToQuote}
          </button>
        </div>
      );
  }
}

/** Hold the mic to record (MediaRecorder), release to send as base64 to /api/miniapp/chat. */
function useRecorder(onDone: (blob: Blob, secs: number) => void, onFail: () => void) {
  const rec = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const wantStop = useRef(false);
  const start = async () => {
    wantStop.current = false;
    try {
      if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("no recorder");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported?.(m));
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const secs = (Date.now() - started.current) / 1000;
        if (secs >= 0.6 && chunks.length) onDone(new Blob(chunks, { type: r.mimeType || "audio/webm" }), secs);
      };
      rec.current = r;
      started.current = Date.now();
      r.start();
      if (wantStop.current) r.stop();
      return true;
    } catch {
      onFail();
      return false;
    }
  };
  const stop = () => {
    wantStop.current = true;
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    rec.current = null;
  };
  return { start, stop };
}

export function ChatScreen() {
  const { t, lang, persona, chat, chatText, chatVoice, setRecording, go, toast, mock } = useApp();
  const now = useNow();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const recorder = useRecorder(
    (b, s) => chatVoice(b, s),
    () => {
      setRecording(false);
      // Demo mode without a microphone: send a stand-in voice note; the mock server transcribes it.
      if (mock) chatVoice(new Blob([new Uint8Array(32)], { type: "audio/webm" }), 3);
      else toast(t.micDenied);
    },
  );
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.msgs.length]);

  const hi = fill(t.chatHi, { n: persona ? `, ${persona.name}` : "" });
  const send = () => {
    chatText(text);
    setText("");
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    setRecording(true);
    void recorder.start();
  };
  const up = () => {
    if (!chat.recording) return;
    setRecording(false);
    recorder.stop();
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="mp-scroll" aria-live="polite">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, padding: "12px 12px 16px" }}>
          <div className="mp-mono" style={{ alignSelf: "center", fontSize: 12, color: "var(--muted)", padding: "4px 0" }}>
            {t.today}
          </div>
          <div className="mp-bubble bot">{hi}</div>
          {chat.msgs.map((m) => (
            <Message key={m.id} m={m} now={now} />
          ))}
          {chat.msgs.length === 0 && !chat.recording ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", paddingTop: 4 }}>
              <button type="button" className="mp-chip" onClick={() => chatText(t.chatAsk)}>
                {t.chatAsk}
              </button>
              <button type="button" className="mp-chip" onClick={() => go("send")}>
                {t.chip2}
              </button>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>
      <div className="mp-composer">
        {chat.recording ? (
          <div className="rec" role="status">
            <span className="mp-dot" style={{ width: 10, height: 10, background: "var(--danger)" }} />
            {t.recording}
          </div>
        ) : (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={t.askPh}
            aria-label={t.askPh}
            maxLength={1000}
            enterKeyHint="send"
            lang={lang}
          />
        )}
        {text.trim() && !chat.recording ? (
          <button type="button" className="mp-mic" onClick={send} aria-label={t.send} disabled={chat.busy}>
            ↑
          </button>
        ) : (
          <button
            type="button"
            className="mp-mic"
            aria-label={t.voice}
            aria-pressed={chat.recording}
            disabled={chat.busy}
            onPointerDown={down}
            onPointerUp={up}
            onPointerCancel={up}
            onPointerLeave={up}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              if (chat.recording) up();
              else {
                setRecording(true);
                void recorder.start();
              }
            }}
          >
            <span style={{ width: 12, height: 18, borderRadius: 6, background: "currentColor" }} />
          </button>
        )}
      </div>
    </div>
  );
}
